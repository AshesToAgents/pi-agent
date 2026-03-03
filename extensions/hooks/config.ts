import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import {
	HOOK_EVENTS,
	type HookConfig,
	type HookEventName,
	type HookHandler,
	type HookListEntry,
	type HookMatcherGroup,
	type HookScope,
	type LoadedHookConfig,
} from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function warn(pathLabel: string, message: string) {
	console.warn(`[hooks-extension] ${pathLabel}: ${message}`);
}

function normalizeTimeout(timeout: unknown): number | undefined {
	if (typeof timeout !== "number" || Number.isNaN(timeout) || timeout <= 0) return undefined;
	return timeout;
}

function normalizeHookHandler(raw: unknown, pathLabel: string): HookHandler | null {
	if (!isObject(raw)) {
		warn(pathLabel, "Ignoring non-object hook handler.");
		return null;
	}

	const type = raw.type;
	if (type === "command") {
		if (typeof raw.command !== "string" || !raw.command.trim()) {
			warn(pathLabel, 'Ignoring command hook without a valid "command" string.');
			return null;
		}
		return {
			type: "command",
			command: raw.command,
			timeout: normalizeTimeout(raw.timeout),
			async: raw.async === true,
		};
	}

	if (type === "http") {
		if (typeof raw.url !== "string" || !raw.url.trim()) {
			warn(pathLabel, 'Ignoring http hook without a valid "url" string.');
			return null;
		}

		const headers: Record<string, string> = {};
		if (isObject(raw.headers)) {
			for (const [key, value] of Object.entries(raw.headers)) {
				if (typeof value === "string") headers[key] = value;
			}
		}

		const allowedEnvVars = Array.isArray(raw.allowedEnvVars)
			? raw.allowedEnvVars
					.map((v) => (typeof v === "string" ? v.trim() : ""))
					.filter(Boolean)
			: undefined;

		return {
			type: "http",
			url: raw.url,
			timeout: normalizeTimeout(raw.timeout),
			headers: Object.keys(headers).length > 0 ? headers : undefined,
			allowedEnvVars,
		};
	}

	warn(pathLabel, `Ignoring hook with unsupported type: ${String(type)}`);
	return null;
}

function normalizeMatcherGroup(raw: unknown, pathLabel: string): HookMatcherGroup | null {
	if (!isObject(raw)) {
		warn(pathLabel, "Ignoring non-object matcher group.");
		return null;
	}

	if (!Array.isArray(raw.hooks)) {
		warn(pathLabel, 'Ignoring matcher group without a valid "hooks" array.');
		return null;
	}

	const hooks: HookHandler[] = [];
	for (const hook of raw.hooks) {
		const normalized = normalizeHookHandler(hook, pathLabel);
		if (normalized) hooks.push(normalized);
	}

	if (hooks.length === 0) {
		warn(pathLabel, "Ignoring matcher group because it has no valid handlers.");
		return null;
	}

	return {
		matcher: typeof raw.matcher === "string" ? raw.matcher : undefined,
		hooks,
	};
}

function normalizeHookConfig(raw: unknown, pathLabel: string): HookConfig {
	if (!isObject(raw)) {
		warn(pathLabel, "Config root must be an object. Ignoring file.");
		return {};
	}

	const hooks: Partial<Record<HookEventName, HookMatcherGroup[]>> = {};
	if (isObject(raw.hooks)) {
		for (const eventName of HOOK_EVENTS) {
			const rawGroups = raw.hooks[eventName];
			if (!Array.isArray(rawGroups)) continue;

			const groups: HookMatcherGroup[] = [];
			for (const group of rawGroups) {
				const normalized = normalizeMatcherGroup(group, `${pathLabel} (${eventName})`);
				if (normalized) groups.push(normalized);
			}

			if (groups.length > 0) hooks[eventName] = groups;
		}
	} else if (raw.hooks !== undefined) {
		warn(pathLabel, 'The "hooks" field must be an object. Ignoring it.');
	}

	return {
		disableAllHooks: raw.disableAllHooks === true,
		debug: raw.debug === true,
		hooks,
	};
}

function readConfigFile(configPath: string): HookConfig {
	if (!fs.existsSync(configPath)) return {};
	try {
		const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		return normalizeHookConfig(raw, configPath);
	} catch (error) {
		warn(configPath, `Failed to load hooks config: ${error instanceof Error ? error.message : String(error)}`);
		return {};
	}
}

function mergeConfigs(globalConfig: HookConfig, projectConfig: HookConfig): HookConfig {
	const hooks: Partial<Record<HookEventName, HookMatcherGroup[]>> = {};
	for (const eventName of HOOK_EVENTS) {
		const globalGroups = globalConfig.hooks?.[eventName] ?? [];
		const projectGroups = projectConfig.hooks?.[eventName] ?? [];
		const merged = [...globalGroups, ...projectGroups];
		if (merged.length > 0) hooks[eventName] = merged;
	}

	return {
		disableAllHooks: Boolean(globalConfig.disableAllHooks || projectConfig.disableAllHooks),
		debug: Boolean(globalConfig.debug || projectConfig.debug),
		hooks,
	};
}

export function getHookConfigPath(scope: HookScope, cwd: string): string {
	if (scope === "global") return path.join(getAgentDir(), "hooks.json");
	return path.join(cwd, ".pi", "hooks.json");
}

export function readScopeConfig(scope: HookScope, cwd: string): HookConfig {
	return readConfigFile(getHookConfigPath(scope, cwd));
}

export function writeScopeConfig(scope: HookScope, cwd: string, config: HookConfig): void {
	const configPath = getHookConfigPath(scope, cwd);
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

export function listHooksByScope(config: LoadedHookConfig): HookListEntry[] {
	const entries: HookListEntry[] = [];

	const pushEntries = (scope: HookScope, source: HookConfig) => {
		for (const eventName of HOOK_EVENTS) {
			const groups = source.hooks?.[eventName] ?? [];
			for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
				const group = groups[groupIndex];
				for (let handlerIndex = 0; handlerIndex < group.hooks.length; handlerIndex++) {
					entries.push({
						scope,
						eventName,
						groupIndex,
						handlerIndex,
						matcher: group.matcher,
						handler: group.hooks[handlerIndex],
					});
				}
			}
		}
	};

	pushEntries("global", config.globalConfig);
	pushEntries("project", config.projectConfig);
	return entries;
}

export function loadConfig(cwd: string): LoadedHookConfig {
	const globalPath = getHookConfigPath("global", cwd);
	const projectPath = getHookConfigPath("project", cwd);
	const globalConfig = readConfigFile(globalPath);
	const projectConfig = readConfigFile(projectPath);
	const mergedConfig = mergeConfigs(globalConfig, projectConfig);

	return {
		cwd,
		globalPath,
		projectPath,
		globalConfig,
		projectConfig,
		mergedConfig,
		disableAllHooks: mergedConfig.disableAllHooks === true,
		debug: mergedConfig.debug === true,
	};
}

export function reloadConfig(cwd: string): LoadedHookConfig {
	return loadConfig(cwd);
}

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { HOOK_EVENTS, type HookConfig, type HookEventName, type HookHandler, type HookScope, type LoadedHookConfig } from "./types.js";
import { listHooksByScope, readScopeConfig, writeScopeConfig } from "./config.js";

type ReloadConfigFn = (cwd: string) => LoadedHookConfig;

function handlerSummary(handler: HookHandler): string {
	if (handler.type === "command") {
		const timeout = handler.timeout ?? 30;
		return `command: ${handler.command} (timeout ${timeout}s${handler.async ? ", async" : ""})`;
	}
	const timeout = handler.timeout ?? 10;
	return `http: ${handler.url} (timeout ${timeout}s)`;
}

function scopeLabel(scope: HookScope): string {
	return scope === "global" ? "Global" : "Project";
}

function formatConfigReport(config: LoadedHookConfig): string {
	const lines: string[] = [];
	lines.push("# Active Hooks");
	lines.push(`disableAllHooks (effective): ${config.disableAllHooks ? "true" : "false"}`);
	lines.push(`disableAllHooks (global): ${config.globalConfig.disableAllHooks === true ? "true" : "false"}`);
	lines.push(`disableAllHooks (project): ${config.projectConfig.disableAllHooks === true ? "true" : "false"}`);
	lines.push("");

	for (const eventName of HOOK_EVENTS) {
		const globalGroups = config.globalConfig.hooks?.[eventName] ?? [];
		const projectGroups = config.projectConfig.hooks?.[eventName] ?? [];
		if (globalGroups.length === 0 && projectGroups.length === 0) continue;

		lines.push(`## ${eventName}`);

		for (const [scope, groups] of [
			["global", globalGroups],
			["project", projectGroups],
		] as const) {
			for (const group of groups) {
				const matcher = group.matcher?.trim() ? group.matcher : "*";
				for (const handler of group.hooks) {
					lines.push(`- [${scopeLabel(scope)}] matcher: ${matcher} -> ${handlerSummary(handler)}`);
				}
			}
		}

		lines.push("");
	}

	if (lines.length === 5) {
		lines.push("No hooks configured.");
	}

	return lines.join("\n");
}

async function selectScope(ctx: ExtensionCommandContext): Promise<HookScope | undefined> {
	const selected = await ctx.ui.select("Select hook scope", ["Global", "Project"]);
	if (!selected) return undefined;
	return selected === "Global" ? "global" : "project";
}

function ensureHooksObject(config: HookConfig): asserts config is HookConfig & { hooks: NonNullable<HookConfig["hooks"]> } {
	if (!config.hooks) config.hooks = {};
}

function parseTimeout(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
	return parsed;
}

async function addHook(ctx: ExtensionCommandContext, reload: ReloadConfigFn): Promise<void> {
	const eventName = (await ctx.ui.select("Select hook event", [...HOOK_EVENTS])) as HookEventName | undefined;
	if (!eventName) return;

	const matcherInput = await ctx.ui.input("Matcher regex (empty = all)", "e.g. bash|write|edit");
	if (matcherInput === undefined) return;
	const matcher = matcherInput.trim() || undefined;

	const typeChoice = await ctx.ui.select("Hook type", ["command", "http"]);
	if (!typeChoice) return;

	let handler: HookHandler | undefined;

	if (typeChoice === "command") {
		const command = await ctx.ui.input("Command hook", "e.g. .pi/hooks/block-rm.sh");
		if (command === undefined) return;
		if (!command.trim()) {
			ctx.ui.notify("Command cannot be empty.", "warning");
			return;
		}

		const timeoutInput = await ctx.ui.input("Timeout in seconds (optional)", "default: 30");
		if (timeoutInput === undefined) return;
		const timeout = parseTimeout(timeoutInput);

		const asyncChoice = await ctx.ui.select("Run asynchronously?", ["No", "Yes"]);
		if (!asyncChoice) return;

		handler = {
			type: "command",
			command: command.trim(),
			timeout,
			async: asyncChoice === "Yes",
		};
	} else {
		const url = await ctx.ui.input("HTTP hook URL", "e.g. http://localhost:8080/hooks");
		if (url === undefined) return;
		if (!url.trim()) {
			ctx.ui.notify("URL cannot be empty.", "warning");
			return;
		}

		const timeoutInput = await ctx.ui.input("Timeout in seconds (optional)", "default: 10");
		if (timeoutInput === undefined) return;
		const timeout = parseTimeout(timeoutInput);

		const headersInput = await ctx.ui.input(
			'Headers JSON (optional, e.g. {"Authorization":"Bearer $MY_TOKEN"})',
			"leave empty for none",
		);
		if (headersInput === undefined) return;

		let headers: Record<string, string> | undefined;
		if (headersInput.trim()) {
			try {
				const parsed = JSON.parse(headersInput) as unknown;
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
					ctx.ui.notify("Headers must be a JSON object.", "warning");
					return;
				}
				headers = {};
				for (const [key, value] of Object.entries(parsed)) {
					if (typeof value === "string") headers[key] = value;
				}
			} catch {
				ctx.ui.notify("Invalid headers JSON.", "warning");
				return;
			}
		}

		const allowedEnvInput = await ctx.ui.input(
			"Allowed env vars for header interpolation (optional, comma-separated)",
			"e.g. MY_TOKEN,API_KEY",
		);
		if (allowedEnvInput === undefined) return;
		const allowedEnvVars = allowedEnvInput
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean);

		handler = {
			type: "http",
			url: url.trim(),
			timeout,
			headers,
			allowedEnvVars: allowedEnvVars.length > 0 ? allowedEnvVars : undefined,
		};
	}

	const scope = await selectScope(ctx);
	if (!scope) return;

	const scopeConfig = readScopeConfig(scope, ctx.cwd);
	ensureHooksObject(scopeConfig);
	if (!scopeConfig.hooks[eventName]) scopeConfig.hooks[eventName] = [];
	scopeConfig.hooks[eventName].push({
		matcher,
		hooks: [handler],
	});

	writeScopeConfig(scope, ctx.cwd, scopeConfig);
	reload(ctx.cwd);
	ctx.ui.notify(`Added ${eventName} hook to ${scopeLabel(scope)} config.`, "success");
}

async function deleteHook(ctx: ExtensionCommandContext, reload: ReloadConfigFn): Promise<void> {
	const config = reload(ctx.cwd);
	const entries = listHooksByScope(config);
	if (entries.length === 0) {
		ctx.ui.notify("No hooks to delete.", "info");
		return;
	}

	const labels = entries.map((entry, index) => {
		const matcher = entry.matcher?.trim() ? entry.matcher : "*";
		return `${index + 1}. [${scopeLabel(entry.scope)}] ${entry.eventName} [${matcher}] -> ${handlerSummary(entry.handler)}`;
	});

	const selected = await ctx.ui.select("Select hook to delete", labels);
	if (!selected) return;
	const selectedIndex = labels.indexOf(selected);
	if (selectedIndex < 0) return;
	const target = entries[selectedIndex];

	const confirmed = await ctx.ui.confirm("Delete hook", selected);
	if (!confirmed) return;

	const scopeConfig = readScopeConfig(target.scope, ctx.cwd);
	const groups = scopeConfig.hooks?.[target.eventName];
	if (!groups || !groups[target.groupIndex]) {
		ctx.ui.notify("Hook no longer exists.", "warning");
		return;
	}

	groups[target.groupIndex].hooks.splice(target.handlerIndex, 1);
	if (groups[target.groupIndex].hooks.length === 0) groups.splice(target.groupIndex, 1);
	if (groups.length === 0 && scopeConfig.hooks) delete scopeConfig.hooks[target.eventName];

	writeScopeConfig(target.scope, ctx.cwd, scopeConfig);
	reload(ctx.cwd);
	ctx.ui.notify("Hook deleted.", "success");
}

async function toggleDisable(ctx: ExtensionCommandContext, reload: ReloadConfigFn): Promise<void> {
	const scope = await selectScope(ctx);
	if (!scope) return;

	const scopeConfig = readScopeConfig(scope, ctx.cwd);
	scopeConfig.disableAllHooks = !Boolean(scopeConfig.disableAllHooks);
	writeScopeConfig(scope, ctx.cwd, scopeConfig);
	reload(ctx.cwd);

	ctx.ui.notify(
		`${scopeLabel(scope)} disableAllHooks set to ${scopeConfig.disableAllHooks ? "true" : "false"}.`,
		"info",
	);
}

export function registerHooksCommand(pi: ExtensionAPI, reload: ReloadConfigFn) {
	pi.registerCommand("hooks", {
		description: "View and manage lifecycle hooks",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/hooks requires interactive UI mode.", "warning");
				return;
			}

			while (true) {
				const choice = await ctx.ui.select("Hooks", [
					"View hooks",
					"Add hook",
					"Delete hook",
					"Toggle disableAllHooks",
					"Exit",
				]);

				if (!choice || choice === "Exit") return;

				switch (choice) {
					case "View hooks": {
						const config = reload(ctx.cwd);
						pi.sendMessage({
							customType: "hooks-extension",
							content: formatConfigReport(config),
							display: true,
							details: {
								disableAllHooks: config.disableAllHooks,
								globalPath: config.globalPath,
								projectPath: config.projectPath,
							},
						});
						ctx.ui.notify("Hook list sent to conversation.", "info");
						break;
					}
					case "Add hook":
						await addHook(ctx, reload);
						break;
					case "Delete hook":
						await deleteHook(ctx, reload);
						break;
					case "Toggle disableAllHooks":
						await toggleDisable(ctx, reload);
						break;
				}
			}
		},
	});
}

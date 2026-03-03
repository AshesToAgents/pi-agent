import { spawn } from "node:child_process";
import type {
	CommandHookHandler,
	HookEventName,
	HookInput,
	HookOutput,
	HookRunResult,
	HttpHookHandler,
	LoadedHookConfig,
	RunHooksResult,
} from "./types.js";

const DEFAULT_COMMAND_TIMEOUT_SECONDS = 30;
const DEFAULT_HTTP_TIMEOUT_SECONDS = 10;

function parseHookOutput(raw: string): HookOutput | undefined {
	const trimmed = raw.trim();
	if (!trimmed) return undefined;

	const tryParse = (value: string): HookOutput | undefined => {
		try {
			const parsed = JSON.parse(value) as unknown;
			if (parsed && typeof parsed === "object") return parsed as HookOutput;
			return undefined;
		} catch {
			return undefined;
		}
	};

	const full = tryParse(trimmed);
	if (full) return full;

	const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	if (lines.length === 0) return undefined;
	return tryParse(lines[lines.length - 1]);
}

function mergeSignal(signal: AbortSignal | undefined, onAbort: () => void): () => void {
	if (!signal) return () => {};
	if (signal.aborted) {
		onAbort();
		return () => {};
	}
	const listener = () => onAbort();
	signal.addEventListener("abort", listener, { once: true });
	return () => signal.removeEventListener("abort", listener);
}

export async function runCommandHook(
	handler: CommandHookHandler,
	input: HookInput,
	signal?: AbortSignal,
): Promise<HookRunResult> {
	const timeoutMs = Math.max(1, handler.timeout ?? DEFAULT_COMMAND_TIMEOUT_SECONDS) * 1000;

	return await new Promise<HookRunResult>((resolve) => {
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;
		let timeoutId: NodeJS.Timeout | undefined;

		const child = spawn(handler.command, {
			shell: true,
			cwd: input.cwd,
			env: {
				...process.env,
				PI_PROJECT_DIR: input.cwd,
				CLAUDE_PROJECT_DIR: input.cwd,
			},
			stdio: ["pipe", "pipe", "pipe"],
		});

		const finish = (result: HookRunResult) => {
			if (settled) return;
			settled = true;
			if (timeoutId) clearTimeout(timeoutId);
			cleanupAbort();
			resolve(result);
		};

		const killChild = () => {
			if (child.killed) return;
			child.kill("SIGTERM");
			setTimeout(() => {
				if (!child.killed) child.kill("SIGKILL");
			}, 1000);
		};

		const cleanupAbort = mergeSignal(signal, () => {
			killChild();
		});

		timeoutId = setTimeout(() => {
			timedOut = true;
			killChild();
		}, timeoutMs);

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});

		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});

		child.on("error", (error) => {
			finish({
				handler,
				exitCode: null,
				stdout,
				stderr,
				error: `Failed to start command hook: ${error.message}`,
			});
		});

		child.on("close", (code) => {
			if (timedOut) {
				finish({
					handler,
					exitCode: code,
					stdout,
					stderr,
					timedOut: true,
					error: `Command hook timed out after ${timeoutMs / 1000}s`,
				});
				return;
			}

			if (code === 2) {
				const output = parseHookOutput(stdout);
				const reason = stderr.trim() || output?.reason || "Blocked by hook";
				finish({
					handler,
					exitCode: code,
					stdout,
					stderr,
					output,
					blocked: true,
					blockReason: reason,
				});
				return;
			}

			if (code === 0) {
				const output = parseHookOutput(stdout);
				finish({
					handler,
					exitCode: code,
					stdout,
					stderr,
					output,
				});
				return;
			}

			finish({
				handler,
				exitCode: code,
				stdout,
				stderr,
				error: `Command hook exited with code ${code ?? "null"}`,
			});
		});

		try {
			child.stdin.write(JSON.stringify(input));
			child.stdin.end();
		} catch {
			// Ignore stdin errors; process close/error will handle final result.
		}
	});
}

function interpolateHeaderValue(value: string, allowedEnvVars: Set<string>): string {
	const replaceValue = (_match: string, varName: string): string => {
		if (!allowedEnvVars.has(varName)) return "";
		return process.env[varName] ?? "";
	};

	return value
		.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, replaceValue)
		.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, replaceValue);
}

export async function runHttpHook(handler: HttpHookHandler, input: HookInput, signal?: AbortSignal): Promise<HookRunResult> {
	const timeoutMs = Math.max(1, handler.timeout ?? DEFAULT_HTTP_TIMEOUT_SECONDS) * 1000;
	const controller = new AbortController();
	let timedOut = false;

	const cleanupAbort = mergeSignal(signal, () => {
		controller.abort();
	});

	const timeoutId = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);

	try {
		const allowedEnvVars = new Set(handler.allowedEnvVars ?? []);
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		for (const [name, value] of Object.entries(handler.headers ?? {})) {
			headers[name] = interpolateHeaderValue(value, allowedEnvVars);
		}

		const response = await fetch(handler.url, {
			method: "POST",
			headers,
			body: JSON.stringify(input),
			signal: controller.signal,
		});

		const text = await response.text();
		const output = parseHookOutput(text);

		if (!response.ok) {
			return {
				handler,
				exitCode: response.status,
				stdout: text,
				stderr: "",
				output,
				error: `HTTP hook responded with status ${response.status}`,
			};
		}

		return {
			handler,
			exitCode: response.status,
			stdout: text,
			stderr: "",
			output,
		};
	} catch (error) {
		const isAbort = error instanceof Error && error.name === "AbortError";
		return {
			handler,
			exitCode: null,
			stdout: "",
			stderr: "",
			timedOut: timedOut || undefined,
			error: isAbort
				? timedOut
					? `HTTP hook timed out after ${timeoutMs / 1000}s`
					: "HTTP hook aborted"
				: `HTTP hook failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	} finally {
		clearTimeout(timeoutId);
		cleanupAbort();
	}
}

function matcherTargetForEvent(eventName: HookEventName, input: HookInput): string | undefined {
	switch (eventName) {
		case "PreToolUse":
		case "PostToolUse":
		case "PostToolUseFailure":
			return typeof input.tool_name === "string" ? input.tool_name : undefined;
		default:
			return undefined;
	}
}

function matchesGroup(eventName: HookEventName, matcher: string | undefined, input: HookInput): boolean {
	if (!matcher || matcher === "*") return true;
	const target = matcherTargetForEvent(eventName, input);
	if (!target) return false;

	try {
		return new RegExp(matcher).test(target);
	} catch {
		console.warn(`[hooks-extension] Invalid matcher regex "${matcher}" for ${eventName}.`);
		return false;
	}
}

function getBlockReason(eventName: HookEventName, result: HookRunResult): string | undefined {
	if (result.blocked) return result.blockReason ?? result.output?.reason ?? "Blocked by hook";

	const output = result.output;
	if (!output) return undefined;

	if (eventName === "PreToolUse") {
		const permissionDecision = output.hookSpecificOutput?.permissionDecision;
		if (permissionDecision === "deny") {
			return output.hookSpecificOutput?.permissionDecisionReason ?? output.reason ?? "Tool use denied by hook";
		}
	}

	if (eventName === "UserPromptSubmit" && output.decision === "block") {
		return output.reason ?? "Prompt blocked by hook";
	}

	return undefined;
}

function getAdditionalContext(result: HookRunResult): string | undefined {
	const values = [
		result.output?.additionalContext,
		result.output?.hookSpecificOutput?.additionalContext,
	].filter((v): v is string => typeof v === "string" && v.trim().length > 0);

	if (values.length === 0) return undefined;
	return values.join("\n\n");
}

export async function runHooks(
	eventName: HookEventName,
	config: LoadedHookConfig,
	input: HookInput,
	signal?: AbortSignal,
): Promise<RunHooksResult> {
	const groups = config.mergedConfig.hooks?.[eventName] ?? [];
	if (config.disableAllHooks || groups.length === 0) {
		return { blocked: false, shouldStop: false, results: [] };
	}

	type Pending = {
		order: number;
		promise: Promise<HookRunResult>;
	};
	type Collected = {
		order: number;
		result: HookRunResult;
	};

	const pending: Pending[] = [];
	const immediate: Collected[] = [];
	let order = 0;

	for (const group of groups) {
		if (!matchesGroup(eventName, group.matcher, input)) continue;

		for (const handler of group.hooks) {
			const currentOrder = order++;
			if (handler.type === "command" && handler.async) {
				void runCommandHook(handler, input).catch((error) => {
					console.warn(`[hooks-extension] Async hook failed: ${error instanceof Error ? error.message : String(error)}`);
				});
				immediate.push({
					order: currentOrder,
					result: {
						handler,
						exitCode: null,
						stdout: "",
						stderr: "",
						async: true,
					},
				});
				continue;
			}

			const promise = handler.type === "command" ? runCommandHook(handler, input, signal) : runHttpHook(handler, input, signal);
			pending.push({ order: currentOrder, promise });
		}
	}

	const resolved = await Promise.all(pending.map(async (item) => ({ order: item.order, result: await item.promise })));
	const results = [...immediate, ...resolved].sort((a, b) => a.order - b.order).map((item) => item.result);

	let blocked = false;
	let blockReason: string | undefined;
	let shouldStop = false;
	let stopReason: string | undefined;
	const contextChunks: string[] = [];

	for (const result of results) {
		if (result.error) {
			console.warn(`[hooks-extension] ${result.error}`);
		}

		if (!shouldStop && result.output?.continue === false) {
			shouldStop = true;
			stopReason = result.output.stopReason ?? "Stopped by hook";
		}

		if (!blocked) {
			const reason = getBlockReason(eventName, result);
			if (reason) {
				blocked = true;
				blockReason = reason;
			}
		}

		const additionalContext = getAdditionalContext(result);
		if (additionalContext) contextChunks.push(additionalContext);
	}

	return {
		blocked,
		blockReason,
		shouldStop,
		stopReason,
		additionalContext: contextChunks.length > 0 ? contextChunks.join("\n\n") : undefined,
		results,
	};
}

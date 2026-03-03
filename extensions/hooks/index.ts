import type {
	ExtensionAPI,
	ExtensionContext,
	InputEventResult,
	ToolCallEventResult,
	ToolResultEventResult,
} from "@mariozechner/pi-coding-agent";
import { registerHooksCommand } from "./command.js";
import { loadConfig, reloadConfig } from "./config.js";
import {
	buildPostToolUseFailureInput,
	buildPostToolUseInput,
	buildPreCompactInput,
	buildPreToolUseInput,
	buildSessionEndInput,
	buildSessionStartInput,
	buildStopInput,
	buildUserPromptSubmitInput,
} from "./events.js";
import { runHooks } from "./runner.js";
import type { HookEventName, HookInput, LoadedHookConfig, RunHooksResult } from "./types.js";

function prependContextToContent(content: ToolResultEventResult["content"], additionalContext: string) {
	if (!content || content.length === 0) {
		return [{ type: "text", text: additionalContext }] as ToolResultEventResult["content"];
	}

	const [first, ...rest] = content;
	if (first.type === "text") {
		return [{ ...first, text: `${additionalContext}\n\n${first.text}` }, ...rest];
	}

	return [{ type: "text", text: additionalContext }, ...content];
}

export default function hooksExtension(pi: ExtensionAPI) {
	let config: LoadedHookConfig = loadConfig(process.cwd());
	let warnedUpdatedInputLimitation = false;

	const debug = (ctx: ExtensionContext, message: string) => {
		if (!config.debug || !ctx.hasUI) return;
		ctx.ui.notify(`[hooks] ${message}`, "info");
	};

	const refreshConfig = (cwd: string): LoadedHookConfig => {
		config = reloadConfig(cwd);
		return config;
	};

	const executeHooks = async (
		eventName: HookEventName,
		input: HookInput,
		ctx: ExtensionContext,
		signal?: AbortSignal,
	): Promise<RunHooksResult> => {
		try {
			const groups = config.mergedConfig.hooks?.[eventName] ?? [];
			if (config.disableAllHooks || groups.length === 0) {
				debug(ctx, `${eventName}: no hooks to run`);
			} else {
				const handlerCount = groups.reduce((sum, g) => sum + g.hooks.length, 0);
				debug(ctx, `${eventName}: running ${handlerCount} hook(s) across ${groups.length} group(s)`);
			}

			const result = await runHooks(eventName, config, input, signal);

			if (result.results.length > 0) {
				for (const r of result.results) {
					const label = r.handler.type === "command" ? r.handler.command : (r.handler as { url: string }).url;
					const short = label.length > 60 ? `${label.slice(0, 57)}...` : label;
					if (r.error) {
						debug(ctx, `${eventName}: ${r.handler.type} hook error — ${short}: ${r.error}`);
					} else if (r.blocked) {
						debug(ctx, `${eventName}: ${r.handler.type} hook BLOCKED — ${short}: ${r.blockReason}`);
					} else if (r.async) {
						debug(ctx, `${eventName}: ${r.handler.type} hook fired async — ${short}`);
					} else {
						debug(ctx, `${eventName}: ${r.handler.type} hook OK (exit ${r.exitCode}) — ${short}`);
					}
					if (r.stdout?.trim()) {
						debug(ctx, `${eventName}: stdout — ${r.stdout.trim().slice(0, 500)}`);
					}
					if (r.stderr?.trim()) {
						debug(ctx, `${eventName}: stderr — ${r.stderr.trim().slice(0, 500)}`);
					}
					if (r.output) {
						debug(ctx, `${eventName}: parsed output — ${JSON.stringify(r.output).slice(0, 500)}`);
					}
				}
			}

			if (result.blocked) {
				debug(ctx, `${eventName}: result BLOCKED — ${result.blockReason}`);
			}
			if (result.additionalContext) {
				debug(ctx, `${eventName}: additional context injected (${result.additionalContext.length} chars)`);
			}

			if (result.shouldStop) {
				if (ctx.hasUI) ctx.ui.notify(result.stopReason ?? "Stopped by hook.", "warning");
				ctx.shutdown();
			}
			return result;
		} catch (error) {
			console.warn(
				`[hooks-extension] Failed to execute ${eventName} hooks: ${error instanceof Error ? error.message : String(error)}`,
			);
			return {
				blocked: false,
				shouldStop: false,
				results: [],
			};
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		refreshConfig(ctx.cwd);
		debug(ctx, `Config loaded (debug=true, disabled=${config.disableAllHooks})`);
		const totalHooks = Object.values(config.mergedConfig.hooks ?? {}).reduce(
			(sum, groups) => sum + groups.reduce((s, g) => s + g.hooks.length, 0),
			0,
		);
		debug(ctx, `${totalHooks} hook(s) registered across ${Object.keys(config.mergedConfig.hooks ?? {}).length} event(s)`);
		await executeHooks("SessionStart", buildSessionStartInput(ctx), ctx);
	});

	pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | void> => {
		const result = await executeHooks("PreToolUse", buildPreToolUseInput(event, ctx), ctx);

		const hasUpdatedInput = result.results.some((run) => run.output?.hookSpecificOutput?.updatedInput !== undefined);
		if (hasUpdatedInput && !warnedUpdatedInputLimitation) {
			warnedUpdatedInputLimitation = true;
			console.warn(
				"[hooks-extension] Hook returned updatedInput, but Pi currently cannot modify tool input in tool_call.",
			);
		}

		if (result.shouldStop) {
			return { block: true, reason: result.stopReason ?? "Stopped by hook" };
		}

		if (result.blocked) {
			return { block: true, reason: result.blockReason ?? "Blocked by hook" };
		}

		return undefined;
	});

	pi.on("tool_result", async (event, ctx): Promise<ToolResultEventResult | void> => {
		const hookEventName: HookEventName = event.isError ? "PostToolUseFailure" : "PostToolUse";
		const input = event.isError ? buildPostToolUseFailureInput(event, ctx) : buildPostToolUseInput(event, ctx);
		const result = await executeHooks(hookEventName, input, ctx);

		if (!result.additionalContext) return undefined;
		return {
			content: prependContextToContent(event.content, result.additionalContext),
		};
	});

	pi.on("input", async (event, ctx): Promise<InputEventResult | void> => {
		const result = await executeHooks("UserPromptSubmit", buildUserPromptSubmitInput(event, ctx), ctx);

		if (result.shouldStop) {
			return { action: "handled" };
		}

		if (result.blocked) {
			if (ctx.hasUI) ctx.ui.notify(result.blockReason ?? "Input blocked by hook", "warning");
			return { action: "handled" };
		}

		if (result.additionalContext) {
			return {
				action: "transform",
				text: `${event.text}\n\n${result.additionalContext}`,
				images: event.images,
			};
		}

		return { action: "continue" };
	});

	pi.on("agent_end", async (event, ctx) => {
		await executeHooks("Stop", buildStopInput(event, ctx), ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		await executeHooks("SessionEnd", buildSessionEndInput(ctx), ctx);
	});

	pi.on("session_before_compact", async (event, ctx) => {
		await executeHooks("PreCompact", buildPreCompactInput(event, ctx), ctx, event.signal);
	});

	registerHooksCommand(pi, refreshConfig);
}

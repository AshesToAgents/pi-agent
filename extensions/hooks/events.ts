import * as path from "node:path";
import type {
	AgentEndEvent,
	ExtensionContext,
	InputEvent,
	SessionBeforeCompactEvent,
	ToolCallEvent,
	ToolResultEvent,
} from "@mariozechner/pi-coding-agent";
import type { HookEventName, HookInput } from "./types.js";

function baseInput(eventName: HookEventName, ctx: ExtensionContext): HookInput {
	return {
		session_id: ctx.sessionManager.getSessionId(),
		cwd: ctx.cwd,
		hook_event_name: eventName,
	};
}

/**
 * Normalize tool input for Claude Code hook compatibility.
 * Pi tools use `path` (often relative), Claude Code hooks expect `file_path` (absolute).
 * Adds `file_path` as an absolute path alias when `path` is present and `file_path` is not.
 */
function normalizeToolInput(input: unknown, cwd: string): unknown {
	if (!input || typeof input !== "object" || Array.isArray(input)) return input;
	const obj = input as Record<string, unknown>;
	if ("path" in obj && !("file_path" in obj) && typeof obj.path === "string") {
		const resolved = path.isAbsolute(obj.path) ? obj.path : path.resolve(cwd, obj.path);
		return { ...obj, file_path: resolved };
	}
	return input;
}

export function buildSessionStartInput(ctx: ExtensionContext): HookInput {
	return baseInput("SessionStart", ctx);
}

export function buildSessionEndInput(ctx: ExtensionContext): HookInput {
	return baseInput("SessionEnd", ctx);
}

export function buildPreToolUseInput(event: ToolCallEvent, ctx: ExtensionContext): HookInput {
	return {
		...baseInput("PreToolUse", ctx),
		tool_name: event.toolName,
		tool_input: normalizeToolInput(event.input, ctx.cwd),
		tool_call_id: event.toolCallId,
	};
}

export function buildPostToolUseInput(event: ToolResultEvent, ctx: ExtensionContext): HookInput {
	return {
		...baseInput("PostToolUse", ctx),
		tool_name: event.toolName,
		tool_input: normalizeToolInput(event.input, ctx.cwd),
		tool_response: {
			content: event.content,
			details: event.details,
			isError: event.isError,
		},
		tool_call_id: event.toolCallId,
	};
}

export function buildPostToolUseFailureInput(event: ToolResultEvent, ctx: ExtensionContext): HookInput {
	return {
		...baseInput("PostToolUseFailure", ctx),
		tool_name: event.toolName,
		tool_input: normalizeToolInput(event.input, ctx.cwd),
		error: {
			content: event.content,
			details: event.details,
			isError: event.isError,
		},
		tool_call_id: event.toolCallId,
	};
}

export function buildUserPromptSubmitInput(event: InputEvent, ctx: ExtensionContext): HookInput {
	return {
		...baseInput("UserPromptSubmit", ctx),
		prompt: event.text,
		source: event.source,
		images: event.images,
	};
}

export function buildStopInput(_event: AgentEndEvent, ctx: ExtensionContext): HookInput {
	return baseInput("Stop", ctx);
}

export function buildPreCompactInput(_event: SessionBeforeCompactEvent, ctx: ExtensionContext): HookInput {
	return baseInput("PreCompact", ctx);
}

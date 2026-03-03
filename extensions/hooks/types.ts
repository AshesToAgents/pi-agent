export const HOOK_EVENTS = [
	"SessionStart",
	"SessionEnd",
	"PreToolUse",
	"PostToolUse",
	"PostToolUseFailure",
	"Stop",
	"UserPromptSubmit",
	"PreCompact",
] as const;

export type HookEventName = (typeof HOOK_EVENTS)[number];
export type HookScope = "global" | "project";

export interface HookMatcherGroup {
	matcher?: string;
	hooks: HookHandler[];
}

export interface CommandHookHandler {
	type: "command";
	command: string;
	timeout?: number;
	async?: boolean;
}

export interface HttpHookHandler {
	type: "http";
	url: string;
	timeout?: number;
	headers?: Record<string, string>;
	allowedEnvVars?: string[];
}

export type HookHandler = CommandHookHandler | HttpHookHandler;

export interface HookConfig {
	disableAllHooks?: boolean;
	debug?: boolean;
	hooks?: Partial<Record<HookEventName, HookMatcherGroup[]>>;
}

export interface HookInput {
	session_id: string;
	cwd: string;
	hook_event_name: HookEventName;
	tool_name?: string;
	tool_input?: unknown;
	tool_response?: unknown;
	error?: unknown;
	prompt?: string;
	source?: string;
	[key: string]: unknown;
}

export interface HookOutput {
	continue?: boolean;
	stopReason?: string;
	decision?: "block" | string;
	reason?: string;
	hookSpecificOutput?: {
		permissionDecision?: "allow" | "deny" | string;
		permissionDecisionReason?: string;
		additionalContext?: string;
		updatedInput?: unknown;
		[key: string]: unknown;
	};
	additionalContext?: string;
	[key: string]: unknown;
}

export interface HookRunResult {
	handler: HookHandler;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	output?: HookOutput;
	blocked?: boolean;
	blockReason?: string;
	timedOut?: boolean;
	error?: string;
	async?: boolean;
}

export interface RunHooksResult {
	blocked: boolean;
	blockReason?: string;
	shouldStop: boolean;
	stopReason?: string;
	additionalContext?: string;
	results: HookRunResult[];
}

export interface LoadedHookConfig {
	cwd: string;
	globalPath: string;
	projectPath: string;
	globalConfig: HookConfig;
	projectConfig: HookConfig;
	mergedConfig: HookConfig;
	disableAllHooks: boolean;
	debug: boolean;
}

export interface HookListEntry {
	scope: HookScope;
	eventName: HookEventName;
	groupIndex: number;
	handlerIndex: number;
	matcher?: string;
	handler: HookHandler;
}

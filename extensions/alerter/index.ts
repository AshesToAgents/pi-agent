import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const APP_TITLE = "Pi Agent";
const ASK_USER_GROUP_SUFFIX = "ask-user";
const SMART_COMMIT_GROUP_SUFFIX = "smart-commit";
const TASK_FINISHED_GROUP_SUFFIX = "task-finished";

function safeSessionId(ctx: ExtensionContext): string {
	const sessionId = ctx.sessionManager.getSessionId().trim();
	return sessionId.length > 0 ? sessionId : "unknown";
}

export default function alerterExtension(pi: ExtensionAPI) {
	let sessionId = "unknown";
	let notificationsEnabled = true;

	const withGroup = (suffix: string) => `pi:${sessionId}:${suffix}`;

	const runAlerter = (args: string[]) => {
		void pi.exec("alerter", args).catch(() => {
			// Ignore missing binary / runtime failures so the extension never breaks the agent.
		});
	};

	const syncContext = (ctx: ExtensionContext) => {
		sessionId = safeSessionId(ctx);
		notificationsEnabled = ctx.hasUI;
	};

	const notifyAskUser = () => {
		if (!notificationsEnabled) return;
		runAlerter([
			"--title",
			APP_TITLE,
			"--message",
			"The agent is asking you a question!",
			"--group",
			withGroup(ASK_USER_GROUP_SUFFIX),
		]);
	};

	const dismissAskUser = () => {
		runAlerter(["--remove", withGroup(ASK_USER_GROUP_SUFFIX)]);
	};

	const notifySmartCommit = () => {
		if (!notificationsEnabled) return;
		runAlerter([
			"--title",
			APP_TITLE,
			"--message",
			"A commit is ready for your review!",
			"--group",
			withGroup(SMART_COMMIT_GROUP_SUFFIX),
		]);
	};

	const dismissSmartCommit = () => {
		runAlerter(["--remove", withGroup(SMART_COMMIT_GROUP_SUFFIX)]);
	};

	const notifyTaskFinished = () => {
		if (!notificationsEnabled) return;
		runAlerter([
			"--title",
			APP_TITLE,
			"--message",
			"Task finished! Waiting for your input.",
			"--group",
			withGroup(TASK_FINISHED_GROUP_SUFFIX),
		]);
	};

	const dismissTaskFinished = () => {
		runAlerter(["--remove", withGroup(TASK_FINISHED_GROUP_SUFFIX)]);
	};

	pi.on("session_start", async (_event, ctx) => {
		syncContext(ctx);
	});

	pi.events.on("ask-user:tool-called", () => {
		notifyAskUser();
	});

	pi.events.on("ask-user:answered", () => {
		dismissAskUser();
	});

	pi.events.on("ask-user:canceled", () => {
		dismissAskUser();
	});

	pi.events.on("smart-commit:review-started", () => {
		notifySmartCommit();
	});

	pi.events.on("smart-commit:committed", () => {
		dismissSmartCommit();
	});

	pi.events.on("smart-commit:skipped", () => {
		dismissSmartCommit();
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		syncContext(ctx);
		dismissTaskFinished();
	});

	pi.on("agent_end", async (_event, ctx) => {
		syncContext(ctx);
		notifyTaskFinished();
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		syncContext(ctx);
		dismissTaskFinished();
	});

	pi.on("session_before_switch", async (_event, ctx) => {
		syncContext(ctx);
		dismissTaskFinished();
	});

	pi.on("session_before_fork", async (_event, ctx) => {
		syncContext(ctx);
		dismissTaskFinished();
	});
}

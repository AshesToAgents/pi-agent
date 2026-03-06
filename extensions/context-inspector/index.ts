import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { contextCommand } from "./context";
import { systemPromptCommand } from "./system-prompt";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("context", {
		description: "Show current context usage breakdown",
		handler: contextCommand,
	});

	pi.registerCommand("system-prompt", {
		description: "Show the full effective system prompt",
		handler: systemPromptCommand,
	});
}

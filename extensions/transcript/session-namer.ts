import * as fs from "node:fs";
import * as path from "node:path";
import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, getAgentDir } from "@mariozechner/pi-coding-agent";
import { type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import { buildTranscript, type TranscriptMessage } from "./transcript.js";

const SETTINGS_KEY = "sessionNamerModel";

function readSettings(): Record<string, unknown> {
	const settingsPath = path.join(getAgentDir(), "settings.json");
	try {
		return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
	} catch {
		return {};
	}
}

function writeSetting(key: string, value: string): void {
	const settingsPath = path.join(getAgentDir(), "settings.json");
	const settings = readSettings();
	settings[key] = value;
	fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

function getConfiguredModel(): string | undefined {
	const settings = readSettings();
	const value = settings[SETTINGS_KEY];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function transcriptToText(transcript: TranscriptMessage[]): string {
	return transcript.map((m) => `${m.label}: ${m.text}`).join("\n\n");
}

const NAMING_PROMPT = [
	"Generate a name for this coding session that would help find it among dozens of other sessions.",
	"Focus on the SPECIFIC outcome or change — not a list of topics touched.",
	"Include distinguishing technical details that make the work unique.",
	"Bad: 'DKIM validation implementation with schema model form and tests' (vague topic list)",
	"Good: 'Add DKIM DNS record validation with per-host status display to email sender management' (specific outcome + distinguishing detail + area)",
	"Bad: 'Refactoring auth module and fixing tests' (generic activities)",
	"Good: 'Extract JWT refresh logic into standalone middleware with token rotation' (concrete change + key detail)",
	"Be concrete about WHAT was built or changed, include the key technical detail that makes it specific.",
	"Return ONLY the session name, nothing else. No quotes, no explanation.",
	"",
	"<conversation>",
].join("\n");

async function generateSessionName(
	transcript: TranscriptMessage[],
	modelRegistry: any,
): Promise<string | null> {
	const modelSpec = getConfiguredModel();
	if (!modelSpec) return null;

	const [provider, ...idParts] = modelSpec.split("/");
	const modelId = idParts.join("/");
	if (!provider || !modelId) return null;

	const model = modelRegistry?.find(provider, modelId);
	if (!model) return null;

	const apiKey = await modelRegistry?.getApiKey(model);
	if (!apiKey) return null;

	const conversationText = transcriptToText(transcript);
	const prompt = `${NAMING_PROMPT}${conversationText}\n</conversation>`;

	const response = await complete(
		model,
		{
			messages: [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: prompt }],
					timestamp: Date.now(),
				},
			],
		},
		{ apiKey },
	);

	const name = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("")
		.trim();

	return name && name.length > 0 && name.length < 100 ? name : null;
}

const SELECT_LIST_THEME = (theme: any) => ({
	selectedPrefix: (t: string) => theme.fg("accent", t),
	selectedText: (t: string) => theme.fg("accent", t),
	description: (t: string) => theme.fg("muted", t),
	scrollInfo: (t: string) => theme.fg("dim", t),
	noMatch: (t: string) => theme.fg("warning", t),
});

export function registerSessionNamer(pi: ExtensionAPI) {
	// Command to configure the model
	pi.registerCommand("session-namer-model", {
		description: "Configure which model generates session names on exit",
		handler: async (_args, ctx) => {
			const current = getConfiguredModel() ?? "(not set — session naming disabled)";

			if (!ctx.hasUI) {
				ctx.ui.notify(`Session namer model: ${current}`, "info");
				return;
			}

			const available = (ctx.modelRegistry?.getAvailable() ?? []).map((m) => `${m.provider}/${m.id}`);
			const unique = Array.from(new Set(available)).sort();

			if (unique.length === 0) {
				ctx.ui.notify("No available models found", "warning");
				return;
			}

			const allItems: SelectItem[] = [
				{ value: "(disable)", label: "(disable)", description: "Turn off auto-naming" },
				...unique.map((m) => ({ value: m, label: m })),
			];

			const selected = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				let filter = "";
				let currentItems = allItems;
				let selectList = new SelectList(currentItems, Math.min(currentItems.length, 12), SELECT_LIST_THEME(theme));
				selectList.onSelect = (item) => done(item.value);
				selectList.onCancel = () => done(null);

				const rebuildList = () => {
					const lower = filter.toLowerCase();
					currentItems = lower
						? allItems.filter((item) => item.value.toLowerCase().includes(lower))
						: allItems;
					selectList = new SelectList(currentItems, Math.min(currentItems.length, 12), SELECT_LIST_THEME(theme));
					selectList.onSelect = (item) => done(item.value);
					selectList.onCancel = () => done(null);
				};

				return {
					render: (w: number) => {
						const border = new DynamicBorder((s: string) => theme.fg("accent", s));
						const lines: string[] = [];
						lines.push(...border.render(w));
						lines.push(...new Text(
							theme.fg("accent", theme.bold("Session Namer Model")) + "  " + theme.fg("dim", `current: ${current}`),
							1, 0,
						).render(w));
						if (filter) {
							lines.push(...new Text(
								theme.fg("accent", "  filter: ") + theme.fg("warning", filter),
								1, 0,
							).render(w));
						}
						lines.push(...selectList.render(w));
						lines.push(...new Text(
							theme.fg("dim", "↑↓ navigate • type to filter • enter select • esc cancel"),
							1, 0,
						).render(w));
						lines.push(...border.render(w));
						return lines;
					},
					invalidate: () => {},
					handleInput: (data: string) => {
						if (data.length === 1 && data >= " " && data <= "~") {
							filter += data;
							rebuildList();
						} else if (data === "\x7f" || data === "\b") {
							if (filter.length > 0) {
								filter = filter.slice(0, -1);
								rebuildList();
							}
						} else {
							selectList.handleInput(data);
						}
						tui.requestRender();
					},
				};
			});

			if (!selected) {
				ctx.ui.notify("Canceled", "warning");
				return;
			}

			if (selected === "(disable)") {
				writeSetting(SETTINGS_KEY, "");
				ctx.ui.notify("Session naming on exit disabled", "info");
			} else {
				writeSetting(SETTINGS_KEY, selected);
				ctx.ui.notify(`Session namer model set to ${selected}`, "success");
			}
		},
	});

	// Command to rename the current session
	pi.registerCommand("session-rename", {
		description: "Rename session: no args = auto-generate, or provide a name",
		handler: async (args, ctx) => {
			const name = args.trim();
			if (name) {
				pi.setSessionName(name);
				ctx.ui.notify(`Session renamed: ${name}`, "success");
				return;
			}

			if (!getConfiguredModel()) {
				ctx.ui.notify("No session namer model configured. Run /session-namer-model first.", "warning");
				return;
			}

			const branch = ctx.sessionManager.getBranch();
			const transcript = buildTranscript(branch);
			if (transcript.length === 0) {
				ctx.ui.notify("No messages in this session", "warning");
				return;
			}

			ctx.ui.notify("Generating session name...", "info");

			try {
				const generated = await generateSessionName(transcript, ctx.modelRegistry);
				if (generated) {
					pi.setSessionName(generated);
					ctx.ui.notify(`Session renamed: ${generated}`, "success");
				} else {
					ctx.ui.notify("Failed to generate session name", "warning");
				}
			} catch (e: any) {
				ctx.ui.notify(`Error: ${e.message ?? e}`, "error");
			}
		},
	});

	// Generate session name on shutdown
	pi.on("session_shutdown", async (_event, ctx) => {
		if (pi.getSessionName()) return;
		if (!getConfiguredModel()) return;

		const branch = ctx.sessionManager.getBranch();
		const transcript = buildTranscript(branch);
		if (transcript.length === 0) return;

		try {
			const name = await generateSessionName(transcript, ctx.modelRegistry);
			if (name) pi.setSessionName(name);
		} catch {
			// Silently fail — don't block shutdown
		}
	});
}

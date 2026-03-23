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
	"Generate a descriptive name for this coding session based on the conversation below.",
	"The name should be 5-12 words that capture the main topic, task, and key details.",
	"Return ONLY the session name, nothing else. No quotes, no explanation.",
	"",
	"<conversation>",
].join("\n");

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

	// Generate session name on shutdown
	pi.on("session_shutdown", async (_event, ctx) => {
		// Skip if name already set
		if (pi.getSessionName()) return;

		const modelSpec = getConfiguredModel();
		if (!modelSpec) return;

		const branch = ctx.sessionManager.getBranch();
		const transcript = buildTranscript(branch);
		if (transcript.length === 0) return;

		// Resolve model
		const [provider, ...idParts] = modelSpec.split("/");
		const modelId = idParts.join("/");
		if (!provider || !modelId) return;

		const model = ctx.modelRegistry?.find(provider, modelId);
		if (!model) return;

		const apiKey = await ctx.modelRegistry?.getApiKey(model);
		if (!apiKey) return;

		const conversationText = transcriptToText(transcript);
		const prompt = `${NAMING_PROMPT}${conversationText}\n</conversation>`;

		try {
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

			if (name && name.length > 0 && name.length < 100) {
				pi.setSessionName(name);
			}
		} catch {
			// Silently fail — don't block shutdown
		}
	});
}

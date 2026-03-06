import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, Text, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block: any) => {
			if (block?.type === "text") return block.text ?? "";
			if (block?.type === "toolCall") return `Tool: ${block.name} ${JSON.stringify(block.arguments ?? {})}`;
			if (block?.type === "thinking") return block.thinking ?? "";
			return "";
		})
		.join("\n");
}

interface CategoryInfo {
	label: string;
	tokens: number;
	color: string;
}

export async function contextCommand(_args: string, ctx: ExtensionCommandContext) {
	if (!ctx.hasUI) return;

	const usage = ctx.getContextUsage();
	const model = ctx.model;

	if (!usage || !model) {
		ctx.ui.notify("Context usage not available", "warning");
		return;
	}

	// Categorize tokens from session entries
	const branch = ctx.sessionManager.getBranch();
	let systemPromptTokens = 0;
	let userTokens = 0;
	let assistantTokens = 0;
	let toolResultTokens = 0;
	let compactionTokens = 0;
	let customTokens = 0;
	let otherTokens = 0;

	// System prompt
	const systemPrompt = ctx.getSystemPrompt();
	systemPromptTokens = estimateTokens(systemPrompt);

	for (const entry of branch) {
		if (entry.type !== "message" || !entry.message) continue;
		const msg = entry.message as any;
		const text = contentToText(msg.content);
		const tokens = estimateTokens(text);

		switch (msg.role) {
			case "user":
				userTokens += tokens;
				break;
			case "assistant":
				assistantTokens += tokens;
				break;
			case "toolResult":
				toolResultTokens += tokens;
				break;
			case "compactionSummary":
				compactionTokens += estimateTokens(msg.summary ?? "");
				break;
			case "custom":
				customTokens += tokens;
				break;
			default:
				otherTokens += tokens;
				break;
		}

		// Handle compaction entries at the entry level
		if (entry.type === "compaction") {
			compactionTokens += estimateTokens((entry as any).summary ?? "");
		}
	}

	// Also check for compaction entries directly
	for (const entry of branch) {
		if ((entry as any).type === "compaction") {
			compactionTokens += estimateTokens((entry as any).summary ?? "");
		}
	}

	const estimatedUsed = systemPromptTokens + userTokens + assistantTokens + toolResultTokens + compactionTokens + customTokens + otherTokens;
	const totalTokens = usage.tokens;
	const contextWindow = usage.contextWindow;
	const freeTokens = contextWindow - totalTokens;

	const categories: CategoryInfo[] = [
		{ label: "System prompt", tokens: systemPromptTokens, color: "accent" },
		{ label: "User messages", tokens: userTokens, color: "success" },
		{ label: "Assistant messages", tokens: assistantTokens, color: "text" },
		{ label: "Tool results", tokens: toolResultTokens, color: "warning" },
		{ label: "Compaction summaries", tokens: compactionTokens, color: "muted" },
		{ label: "Custom entries", tokens: customTokens, color: "dim" },
	];

	if (otherTokens > 0) {
		categories.push({ label: "Other", tokens: otherTokens, color: "dim" });
	}

	await ctx.ui.custom((_tui, theme, _kb, done) => {
		const container = new Container();
		const border = new DynamicBorder((s: string) => theme.fg("accent", s));

		container.addChild(border);

		// Header
		const modelName = `${model.provider}/${model.id}`;
		const pctRounded = usage.percent.toFixed(1);
		const tokenStr = `${formatTokens(totalTokens)}/${formatTokens(contextWindow)} tokens (${pctRounded}%)`;
		container.addChild(new Text(theme.fg("accent", theme.bold("Context Usage")), 1, 0));
		container.addChild(new Text(theme.fg("muted", modelName) + "  " + theme.bold(tokenStr), 1, 0));
		container.addChild(new Text("", 0, 0));

		// Progress bar
		const barWidth = 40;
		const filled = Math.round((usage.percent / 100) * barWidth);
		const barColor = usage.percent > 90 ? "error" : usage.percent > 70 ? "warning" : "success";
		const bar = theme.fg(barColor as any, "█".repeat(filled)) + theme.fg("dim", "░".repeat(barWidth - filled));
		container.addChild(new Text(`  ${bar} ${pctRounded}%`, 1, 0));
		container.addChild(new Text("", 0, 0));

		// Category breakdown
		container.addChild(new Text(theme.fg("muted", "Estimated usage by category (chars/4 heuristic):"), 1, 0));

		for (const cat of categories) {
			if (cat.tokens === 0) continue;
			const pct = contextWindow > 0 ? ((cat.tokens / contextWindow) * 100).toFixed(1) : "0.0";
			const dot = theme.fg(cat.color as any, "●");
			const line = `  ${dot} ${cat.label.padEnd(22)} ${formatTokens(cat.tokens).padStart(8)}  (${pct}%)`;
			container.addChild(new Text(line, 1, 0));
		}

		container.addChild(new Text("", 0, 0));
		const freeColor = freeTokens < 10000 ? "error" : freeTokens < 30000 ? "warning" : "success";
		const freePct = contextWindow > 0 ? ((freeTokens / contextWindow) * 100).toFixed(1) : "0.0";
		container.addChild(new Text(`  ${theme.fg(freeColor as any, "○")} ${"Free space".padEnd(22)} ${formatTokens(freeTokens).padStart(8)}  (${freePct}%)`, 1, 0));

		container.addChild(new Text("", 0, 0));
		container.addChild(new Text(theme.fg("dim", "Press any key to close"), 1, 0));
		container.addChild(border);

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (_data: string) => {
				done(undefined);
			},
		};
	});
}

function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
	return `${tokens}`;
}

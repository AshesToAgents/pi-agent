import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Text, matchesKey } from "@mariozechner/pi-tui";

export async function systemPromptCommand(_args: string, ctx: ExtensionCommandContext) {
	if (!ctx.hasUI) return;

	const systemPrompt = ctx.getSystemPrompt();

	if (!systemPrompt) {
		ctx.ui.notify("No system prompt available", "warning");
		return;
	}

	const charCount = systemPrompt.length;
	const estimatedTokens = Math.ceil(charCount / 4);

	await ctx.ui.custom((_tui, theme, _kb, done) => {
		const container = new Container();
		const border = new DynamicBorder((s: string) => theme.fg("accent", s));
		const mdTheme = getMarkdownTheme();

		container.addChild(border);
		container.addChild(new Text(theme.fg("accent", theme.bold("System Prompt")), 1, 0));
		container.addChild(
			new Text(theme.fg("muted", `${charCount.toLocaleString()} chars · ~${estimatedTokens.toLocaleString()} tokens (estimated)`), 1, 0)
		);
		container.addChild(new Text("", 0, 0));
		container.addChild(new Markdown(systemPrompt, 1, 0, mdTheme));
		container.addChild(new Text("", 0, 0));
		container.addChild(new Text(theme.fg("dim", "Press Escape to close"), 1, 0));
		container.addChild(border);

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "escape")) {
					done(undefined);
				}
			},
		};
	});
}

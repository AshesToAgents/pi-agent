import { type ExtensionAPI, VERSION } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

function fmt(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
	return `${n}`;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					// -- Line 1: path (branch)  context  model · thinking --

					const branch = footerData.getGitBranch();
					const branchStr = branch ? ` (${branch})` : "";
					const cwd = process.cwd().replace(process.env.HOME ?? "", "~");
					const left = theme.fg("dim", `pi ${VERSION}`) + "  " + theme.fg("accent", `${cwd}${branchStr}`);

					const usage = ctx.getContextUsage();
					const tokens = usage?.tokens ?? 0;
					const window = usage?.contextWindow ?? 0;
					const pct = window > 0 ? Math.round((tokens / window) * 100) : 0;
					const contextColor = pct > 80 ? "error" : pct >= 50 ? "warning" : "success";
					const contextStr = theme.fg(contextColor as any, `${fmt(tokens)}/${fmt(window)} (${pct}%)`);

					const model = ctx.model?.id ?? "no-model";
					const thinking = pi.getThinkingLevel();
					const right = theme.fg("muted", `${model} (${thinking})`);

					const gap1 = " ".repeat(Math.max(2, width - visibleWidth(left) - visibleWidth(contextStr) - visibleWidth(right) - 4));
					const gap2 = "  ";
					const line1 = truncateToWidth(`${left}${gap1}${contextStr}${gap2}${right}`, width);

					const lines = [line1];

					// -- Lines 2+: one per extension status --

					const statuses = footerData.getExtensionStatuses();
					for (const [, value] of statuses) {
						lines.push(truncateToWidth(value, width));
					}

					return lines;
				},
			};
		});
	});
}

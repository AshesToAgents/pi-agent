import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text, matchesKey } from "@mariozechner/pi-tui";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

interface UsageWindow {
	utilization: number;
	resets_at: string | null;
}

interface UsageResponse {
	five_hour: UsageWindow | null;
	seven_day: UsageWindow | null;
	seven_day_opus: UsageWindow | null;
	seven_day_sonnet: UsageWindow | null;
	extra_usage: {
		is_enabled: boolean;
		monthly_limit: number;
		used_credits: number;
		utilization: number;
	} | null;
}

interface CachedUsage {
	data: UsageResponse;
	fetchedAt: number;
}

const CACHE_DIR = join(process.env.HOME ?? "~", ".pi", "agent", "data");
const CACHE_FILE = join(CACHE_DIR, "anthropic-usage-cache.json");
const COOLDOWN_MS = 60_000;

let lastFetchTime = 0;
let lastUsageData: UsageResponse | null = null;
let lastFetchFailed = false;

function loadCache(): void {
	try {
		const raw = readFileSync(CACHE_FILE, "utf-8");
		const cached: CachedUsage = JSON.parse(raw);
		lastUsageData = cached.data;
		lastFetchTime = cached.fetchedAt;
	} catch {
		// No cache or invalid — that's fine
	}
}

function saveCache(): void {
	if (!lastUsageData) return;
	try {
		mkdirSync(CACHE_DIR, { recursive: true });
		writeFileSync(CACHE_FILE, JSON.stringify({ data: lastUsageData, fetchedAt: lastFetchTime } satisfies CachedUsage));
	} catch {
		// Non-critical
	}
}

function isAnthropicModel(ctx: ExtensionContext): boolean {
	return ctx.model?.provider === "anthropic";
}

function isOAuthKey(key: string): boolean {
	return key.startsWith("sk-ant-oat");
}

async function fetchUsage(ctx: ExtensionContext, quiet = false): Promise<UsageResponse | null> {
	if (!isAnthropicModel(ctx)) return null;

	const apiKey = await ctx.modelRegistry.getApiKey(ctx.model!);
	if (!apiKey) {
		if (!quiet) ctx.ui.notify("No API key configured for Anthropic", "warning");
		lastFetchFailed = true;
		return null;
	}
	if (!isOAuthKey(apiKey)) {
		if (!quiet) ctx.ui.notify("Usage requires OAuth key (sk-ant-oat-*)", "warning");
		lastFetchFailed = true;
		return null;
	}

	try {
		const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"anthropic-beta": "oauth-2025-04-20",
				"Content-Type": "application/json",
			},
		});
		if (!res.ok) {
			if (!quiet) {
				const msg = res.status === 429 ? "Rate limited while fetching usage" : `Usage fetch failed: HTTP ${res.status}`;
				ctx.ui.notify(msg, "warning");
			}
			lastFetchFailed = true;
			return null;
		}
		lastFetchFailed = false;
		const data = (await res.json()) as UsageResponse;
		lastUsageData = data;
		lastFetchTime = Date.now();
		saveCache();
		return data;
	} catch (e: any) {
		if (!quiet) ctx.ui.notify(`Usage fetch error: ${e.message}`, "warning");
		lastFetchFailed = true;
		return null;
	}
}

function formatResetTime(resetsAt: string | null): string {
	if (!resetsAt) return "";
	const d = new Date(resetsAt);
	const now = new Date();
	const diffMs = d.getTime() - now.getTime();

	if (diffMs < 0) return "(expired)";

	if (diffMs < 24 * 60 * 60 * 1000) {
		return `(resets ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})`;
	}

	return `(resets ${d.toLocaleDateString([], { weekday: "short" })}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})`;
}

function progressBar(pct: number, width: number = 10): string {
	const clamped = Math.max(0, Math.min(100, pct));
	const filled = Math.round((clamped / 100) * width);
	return "▓".repeat(filled) + "░".repeat(width - filled);
}

function colorForPct(pct: number, theme: any): (text: string) => string {
	if (pct > 80) return (t: string) => theme.fg("error", t);
	if (pct >= 50) return (t: string) => theme.fg("warning", t);
	return (t: string) => theme.fg("success", t);
}

function widgetLine(data: UsageResponse, theme: any): string[] {
	const parts: string[] = [];

	if (data.five_hour) {
		const pct = Math.round(data.five_hour.utilization);
		const color = colorForPct(pct, theme);
		parts.push(color(`5hr: ${pct}%`));
	}
	if (data.seven_day) {
		const pct = Math.round(data.seven_day.utilization);
		const color = colorForPct(pct, theme);
		parts.push(color(`7d: ${pct}%`));
	}

	if (parts.length === 0) return [];
	let line = `Usage: ${parts.join(theme.fg("dim", " │ "))}`;
	if (lastFetchFailed) line += theme.fg("dim", " (cached)");
	return [line];
}

function updateStatus(ctx: ExtensionContext) {
	if (!ctx.hasUI) return;
	if (!lastUsageData) {
		ctx.ui.setStatus("anthropic-usage", undefined);
		return;
	}
	const theme = ctx.ui.theme;
	const lines = widgetLine(lastUsageData!, theme);
	ctx.ui.setStatus("anthropic-usage", lines.length > 0 ? lines[0] : undefined);
}

async function fetchAndUpdateStatus(ctx: ExtensionContext, forceFetch = false) {
	if (!isAnthropicModel(ctx)) {
		ctx.ui.setStatus("anthropic-usage", undefined);
		return;
	}

	if (!forceFetch && Date.now() - lastFetchTime < COOLDOWN_MS && lastUsageData) {
		updateStatus(ctx);
		return;
	}

	const data = await fetchUsage(ctx, true);
	if (data) {
		updateStatus(ctx);
	} else if (lastUsageData) {
		updateStatus(ctx);
	}
}

export default function (pi: ExtensionAPI) {
	// Load disk cache on extension init
	loadCache();

	// /usage command — rich display
	pi.registerCommand("usage", {
		description: "Show Anthropic API usage and rate limits",
		handler: async (_args, ctx) => {
			if (!isAnthropicModel(ctx)) {
				ctx.ui.notify("Only Anthropic models supported for usage tracking", "warning");
				return;
			}

			const data = await fetchUsage(ctx);
			if (!data && !lastUsageData) return;

			const displayData = data ?? lastUsageData!;
			const isStale = !data && !!lastUsageData;

			// Also update status with fresh data
			updateStatus(ctx);

			await ctx.ui.custom<void>((tui, theme, _kb, done) => {
				const lines: string[] = [];

				let title = theme.bold(theme.fg("accent", "Anthropic API Usage"));
				if (isStale) {
					const ago = Math.round((Date.now() - lastFetchTime) / 60_000);
					title += theme.fg("dim", `  (cached ${ago}m ago)`);
				}
				lines.push(title);
				lines.push(theme.fg("dim", "─".repeat(30)));

				if (displayData.five_hour) {
					const pct = Math.round(displayData.five_hour.utilization);
					const color = colorForPct(pct, theme);
					const bar = color(progressBar(pct));
					const reset = theme.fg("dim", formatResetTime(displayData.five_hour.resets_at));
					lines.push(`5-Hour:   ${bar}  ${color(pct + "%")}  ${reset}`);
				}

				if (displayData.seven_day) {
					const pct = Math.round(displayData.seven_day.utilization);
					const color = colorForPct(pct, theme);
					const bar = color(progressBar(pct));
					const reset = theme.fg("dim", formatResetTime(displayData.seven_day.resets_at));
					lines.push(`7-Day:    ${bar}  ${color(pct + "%")}  ${reset}`);
				}

				if (displayData.seven_day_sonnet) {
					const pct = Math.round(displayData.seven_day_sonnet.utilization);
					const color = colorForPct(pct, theme);
					const bar = color(progressBar(pct));
					const reset = theme.fg("dim", formatResetTime(displayData.seven_day_sonnet.resets_at));
					lines.push(`Sonnet:   ${bar}  ${color(pct + "%")}  ${reset}`);
				}

				if (displayData.seven_day_opus) {
					const pct = Math.round(displayData.seven_day_opus.utilization);
					const color = colorForPct(pct, theme);
					const bar = color(progressBar(pct));
					const reset = theme.fg("dim", formatResetTime(displayData.seven_day_opus.resets_at));
					lines.push(`Opus:     ${bar}  ${color(pct + "%")}  ${reset}`);
				}

				if (displayData.extra_usage) {
					const used = displayData.extra_usage.used_credits ?? 0;
					const limit = displayData.extra_usage.monthly_limit ?? 0;
					const enabled = displayData.extra_usage.is_enabled;
					const label = enabled ? theme.fg("muted", `$${used.toFixed(2)} / $${limit.toFixed(2)}`) : theme.fg("dim", "disabled");
					lines.push(`Extra:    ${label}`);
				}

				lines.push("");
				lines.push(theme.fg("dim", "Press Escape to close"));

				const text = new Text(lines.join("\n"), 1, 1);

				return {
					render: (width: number) => text.render(width),
					invalidate: () => text.invalidate(),
					handleInput: (data: string) => {
						if (matchesKey(data, "escape") || matchesKey(data, "enter") || data === "q") {
							done();
						}
					},
				};
			});
		},
	});

	// Session start — show cached status immediately, then try to fetch fresh
	pi.on("session_start", async (_event, ctx) => {
		if (isAnthropicModel(ctx)) {
			if (lastUsageData) updateStatus(ctx);
			await fetchAndUpdateStatus(ctx, true);
		}
	});

	// Agent end — refresh status with cooldown
	pi.on("agent_end", async (_event, ctx) => {
		if (isAnthropicModel(ctx)) {
			await fetchAndUpdateStatus(ctx);
		}
	});

	// Model select — show/hide status
	pi.on("model_select", async (event, ctx) => {
		if (event.model.provider === "anthropic") {
			await fetchAndUpdateStatus(ctx);
		} else {
			lastUsageData = null;
			ctx.ui.setStatus("anthropic-usage", undefined);
		}
	});
}

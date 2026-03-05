/**
 * Web Tools Extension
 *
 * Adds Anthropic's web_search and web_fetch server-side tools as custom pi tools.
 * These tools are only active when the current model is from an Anthropic provider.
 *
 * The tools make direct Anthropic Messages API calls with the server-side tool types,
 * then extract and return the results.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { keyHint } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const TOOL_NAMES = ["web_search", "web_fetch"] as const;

interface SearchResultItem {
	title: string;
	url: string;
}

interface WebSearchDetails {
	query: string;
	resultCount: number;
	results: SearchResultItem[];
	/** Model's text response (summary/explanation), if any */
	responseText: string | undefined;
	model: string;
	stopReason: string | undefined;
	usage: { input: number; output: number } | undefined;
}

interface WebFetchDetails {
	url: string;
	contentLength: number;
	/** Model's text response (summary/explanation), if any */
	responseText: string | undefined;
	model: string;
	stopReason: string | undefined;
	usage: { input: number; output: number } | undefined;
}

export default function webToolsExtension(pi: ExtensionAPI) {
	let isAnthropicModel = false;

	function updateToolAvailability() {
		const active = pi.getActiveTools();
		if (isAnthropicModel) {
			// Add our tools if not already present
			const updated = [...active];
			for (const name of TOOL_NAMES) {
				if (!updated.includes(name)) updated.push(name);
			}
			if (updated.length !== active.length) {
				pi.setActiveTools(updated);
			}
		} else {
			// Remove our tools
			const filtered = active.filter((t) => !(TOOL_NAMES as readonly string[]).includes(t));
			if (filtered.length !== active.length) {
				pi.setActiveTools(filtered);
			}
		}
	}

	pi.on("model_select", async (event, _ctx) => {
		isAnthropicModel = event.model.provider === "anthropic";
		updateToolAvailability();
	});

	pi.on("session_start", async (_event, ctx) => {
		isAnthropicModel = ctx.model?.provider === "anthropic";
		updateToolAvailability();
	});

	// --- web_search tool ---
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: "Search the web using Anthropic's web search. Returns search results with titles, URLs, and snippets.",
		promptSnippet: "Search the web for information (Anthropic models only)",
		promptGuidelines: [
			"Use web_search when the user needs current information from the internet.",
			"This tool is only available when using an Anthropic model.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			max_uses: Type.Optional(Type.Number({ description: "Maximum number of searches per request (omit for unlimited)" })),
		}),
		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("web_search "));
			text += theme.fg("dim", `"${args.query}"`);
			if (args.max_uses !== undefined) text += theme.fg("muted", ` (max_uses: ${args.max_uses})`);
			return new Text(text, 0, 0);
		},
		renderResult(result, options, theme) {
			const details = (result.details ?? {}) as Partial<WebSearchDetails>;

			if (result.isError) {
				const errorContent = result.content.find((c) => c.type === "text");
				const errorMsg = errorContent?.type === "text" ? errorContent.text : "Search failed";
				// First line of the error for collapsed view
				const firstLine = errorMsg.split("\n")[0].slice(0, 120);

				if (!options.expanded) {
					let text = theme.fg("error", `✗ ${firstLine}`);
					text += theme.fg("muted", ` (${keyHint("expandTools", "to expand")})`);
					return new Text(text, 0, 0);
				}

				const lines: string[] = [];
				lines.push(theme.fg("error", "✗ web_search failed"));
				if (details.query) lines.push(theme.fg("muted", `query: `) + theme.fg("dim", `"${details.query}"`));
				if (details.model) lines.push(theme.fg("muted", `model: ${details.model}`));
				lines.push(theme.fg("error", errorMsg));
				return new Text(lines.join("\n"), 0, 0);
			}

			const count = details.resultCount ?? 0;

			if (!options.expanded) {
				// Collapsed: compact summary with expand hint
				let text = theme.fg("success", `✓ ${count} result${count === 1 ? "" : "s"}`);
				if (details.usage) {
					text += theme.fg("muted", ` (${details.usage.input}→${details.usage.output} tokens)`);
				}
				text += theme.fg("muted", ` (${keyHint("expandTools", "to expand")})`);
				return new Text(text, 0, 0);
			}

			// Expanded: show individual results + model response + usage
			const lines: string[] = [];
			lines.push(theme.fg("success", `✓ ${count} result${count === 1 ? "" : "s"}`));

			for (const r of details.results ?? []) {
				lines.push(`  ${theme.fg("text", r.title)}`);
				lines.push(`  ${theme.fg("dim", r.url)}`);
			}

			if (details.responseText) {
				lines.push(theme.fg("muted", `response: `) + theme.fg("dim", details.responseText));
			}

			if (details.usage) {
				lines.push(theme.fg("muted", `tokens: ${details.usage.input} in → ${details.usage.output} out`));
			}
			if (details.model) {
				lines.push(theme.fg("muted", `model: ${details.model}`));
			}
			if (details.stopReason) {
				lines.push(theme.fg("muted", `stop: ${details.stopReason}`));
			}

			return new Text(lines.join("\n"), 0, 0);
		},
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const errorDetails = (extra?: Partial<WebSearchDetails>): Partial<WebSearchDetails> => ({
				query: params.query,
				model: ctx.model?.id ?? "unknown",
				...extra,
			});

			if (ctx.model?.provider !== "anthropic") {
				return {
					content: [{ type: "text", text: "Error: web_search is only available with Anthropic models." }],
					isError: true,
					details: errorDetails(),
				};
			}

			const apiKey = await ctx.modelRegistry.getApiKeyForProvider("anthropic");
			if (!apiKey) {
				return {
					content: [{ type: "text", text: "Error: No Anthropic API key configured." }],
					isError: true,
					details: errorDetails(),
				};
			}

			try {
				const toolDef: any = { type: "web_search_20250305", name: "web_search" };
				if (params.max_uses !== undefined) toolDef.max_uses = params.max_uses;

				const response = await fetch("https://api.anthropic.com/v1/messages", {
					method: "POST",
					headers: {
						"Content-type": "application/json",
						"x-api-key": apiKey,
						"anthropic-version": "2023-06-01",
					},
					body: JSON.stringify({
						model: ctx.model.id,
						max_tokens: 4096,
						tools: [toolDef],
						messages: [
							{
								role: "user",
								content: `Search the web for: ${params.query}`,
							},
						],
					}),
					signal,
				});

				if (!response.ok) {
					const errText = await response.text();
					return {
						content: [{ type: "text", text: `Error: Anthropic API returned ${response.status}: ${errText}` }],
						isError: true,
						details: errorDetails(),
					};
				}

				const data = await response.json();
				const { text, searchResults, responseText } = extractSearchResultsWithDetails(data);

				const details: WebSearchDetails = {
					query: params.query,
					resultCount: searchResults.length,
					results: searchResults,
					responseText,
					model: data.model ?? ctx.model.id,
					stopReason: data.stop_reason,
					usage: data.usage
						? { input: data.usage.input_tokens, output: data.usage.output_tokens }
						: undefined,
				};

				return {
					content: [{ type: "text", text }],
					details,
				};
			} catch (err: any) {
				if (err.name === "AbortError") {
					return { content: [{ type: "text", text: "Search cancelled." }] };
				}
				return {
					content: [{ type: "text", text: `Error: ${err.message}` }],
					isError: true,
					details: errorDetails(),
				};
			}
		},
	});

	// --- web_fetch tool ---
	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description: "Fetch a web page and return its content as text. Uses Anthropic's web fetch to get clean page content.",
		promptSnippet: "Fetch a web page and return its content (Anthropic models only)",
		promptGuidelines: [
			"Use web_fetch to retrieve the content of a specific URL.",
			"This tool is only available when using an Anthropic model.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "URL to fetch" }),
			max_uses: Type.Optional(Type.Number({ description: "Maximum number of fetches per request (omit for unlimited)" })),
			citations: Type.Optional(Type.Boolean({ description: "Enable citations for fetched content (default: off)" })),
		}),
		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("web_fetch "));
			text += theme.fg("dim", args.url);
			const extras: string[] = [];
			if (args.max_uses !== undefined) extras.push(`max_uses: ${args.max_uses}`);
			if (args.citations) extras.push("citations: on");
			if (extras.length) text += theme.fg("muted", ` (${extras.join(", ")})`);
			return new Text(text, 0, 0);
		},
		renderResult(result, options, theme) {
			const details = (result.details ?? {}) as Partial<WebFetchDetails>;

			if (result.isError) {
				const errorContent = result.content.find((c) => c.type === "text");
				const errorMsg = errorContent?.type === "text" ? errorContent.text : "Fetch failed";
				const firstLine = errorMsg.split("\n")[0].slice(0, 120);

				if (!options.expanded) {
					let text = theme.fg("error", `✗ ${firstLine}`);
					text += theme.fg("muted", ` (${keyHint("expandTools", "to expand")})`);
					return new Text(text, 0, 0);
				}

				const lines: string[] = [];
				lines.push(theme.fg("error", "✗ web_fetch failed"));
				if (details.url) lines.push(theme.fg("muted", `url: `) + theme.fg("dim", details.url));
				if (details.model) lines.push(theme.fg("muted", `model: ${details.model}`));
				lines.push(theme.fg("error", errorMsg));
				return new Text(lines.join("\n"), 0, 0);
			}

			const sizeStr = formatBytes(details.contentLength ?? 0);

			if (!options.expanded) {
				// Collapsed: compact summary
				let text = theme.fg("success", `✓ fetched (${sizeStr})`);
				if (details.usage) {
					text += theme.fg("muted", ` (${details.usage.input}→${details.usage.output} tokens)`);
				}
				text += theme.fg("muted", ` (${keyHint("expandTools", "to expand")})`);
				return new Text(text, 0, 0);
			}

			// Expanded: show details
			const lines: string[] = [];
			lines.push(theme.fg("success", `✓ fetched (${sizeStr})`));
			if (details.url) {
				lines.push(theme.fg("dim", details.url));
			}
			if (details.responseText) {
				lines.push(theme.fg("muted", `response: `) + theme.fg("dim", details.responseText));
			}
			if (details.usage) {
				lines.push(theme.fg("muted", `tokens: ${details.usage.input} in → ${details.usage.output} out`));
			}
			if (details.model) {
				lines.push(theme.fg("muted", `model: ${details.model}`));
			}
			if (details.stopReason) {
				lines.push(theme.fg("muted", `stop: ${details.stopReason}`));
			}

			return new Text(lines.join("\n"), 0, 0);
		},
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const errorDetails = (extra?: Partial<WebFetchDetails>): Partial<WebFetchDetails> => ({
				url: params.url,
				model: ctx.model?.id ?? "unknown",
				...extra,
			});

			if (ctx.model?.provider !== "anthropic") {
				return {
					content: [{ type: "text", text: "Error: web_fetch is only available with Anthropic models." }],
					isError: true,
					details: errorDetails(),
				};
			}

			const apiKey = await ctx.modelRegistry.getApiKeyForProvider("anthropic");
			if (!apiKey) {
				return {
					content: [{ type: "text", text: "Error: No Anthropic API key configured." }],
					isError: true,
					details: errorDetails(),
				};
			}

			try {
				const toolDef: any = { type: "web_fetch_20250910", name: "web_fetch" };
				if (params.max_uses !== undefined) toolDef.max_uses = params.max_uses;
				if (params.citations) toolDef.citations = { enabled: true };

				const response = await fetch("https://api.anthropic.com/v1/messages", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-api-key": apiKey,
						"anthropic-version": "2023-06-01",
					},
					body: JSON.stringify({
						model: ctx.model.id,
						max_tokens: 4096,
						tools: [toolDef],
						messages: [
							{
								role: "user",
								content: `Fetch the content of this URL: ${params.url}`,
							},
						],
					}),
					signal,
				});

				if (!response.ok) {
					const errText = await response.text();
					return {
						content: [{ type: "text", text: `Error: Anthropic API returned ${response.status}: ${errText}` }],
						isError: true,
						details: errorDetails(),
					};
				}

				const data = await response.json();
				const { text: content, responseText } = extractFetchContentWithDetails(data);

				const details: WebFetchDetails = {
					url: params.url,
					contentLength: content.length,
					responseText,
					model: data.model ?? ctx.model.id,
					stopReason: data.stop_reason,
					usage: data.usage
						? { input: data.usage.input_tokens, output: data.usage.output_tokens }
						: undefined,
				};

				return {
					content: [{ type: "text", text: content }],
					details,
				};
			} catch (err: any) {
				if (err.name === "AbortError") {
					return { content: [{ type: "text", text: "Fetch cancelled." }] };
				}
				return {
					content: [{ type: "text", text: `Error: ${err.message}` }],
					isError: true,
					details: errorDetails(),
				};
			}
		},
	});
}

/**
 * Format byte count to human-readable string.
 */
function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Extract search results from an Anthropic Messages API response that used web_search.
 * Returns both formatted text and structured result items for details.
 */
function extractSearchResultsWithDetails(data: any): { text: string; searchResults: SearchResultItem[]; responseText: string | undefined } {
	const parts: string[] = [];
	const searchResults: SearchResultItem[] = [];
	const modelTextParts: string[] = [];

	for (const block of data.content ?? []) {
		if (block.type === "web_search_tool_result") {
			for (const result of block.content ?? []) {
				if (result.type === "web_search_result") {
					parts.push(`### ${result.title}\n${result.url}\n${result.encrypted_content ?? result.page_content ?? result.snippet ?? ""}\n`);
					searchResults.push({ title: result.title, url: result.url });
				}
			}
		}
		if (block.type === "text" && block.text) {
			parts.push(block.text);
			modelTextParts.push(block.text);
		}
	}

	return {
		text: parts.length > 0 ? parts.join("\n") : "No search results found.",
		searchResults,
		responseText: modelTextParts.length > 0 ? modelTextParts.join("\n") : undefined,
	};
}

/**
 * Extract fetched page content from an Anthropic Messages API response that used web_fetch.
 */
function extractFetchContentWithDetails(data: any): { text: string; responseText: string | undefined } {
	const parts: string[] = [];
	const modelTextParts: string[] = [];

	for (const block of data.content ?? []) {
		if (block.type === "web_fetch_tool_result") {
			if (block.content) {
				if (typeof block.content === "string") {
					parts.push(block.content);
				} else if (Array.isArray(block.content)) {
					for (const item of block.content) {
						if (item.type === "web_fetch_result" || item.type === "text") {
							parts.push(item.text ?? item.content ?? "");
						}
					}
				}
			}
		}
		if (block.type === "text" && block.text) {
			parts.push(block.text);
			modelTextParts.push(block.text);
		}
	}

	return {
		text: parts.length > 0 ? parts.join("\n") : "No content fetched.",
		responseText: modelTextParts.length > 0 ? modelTextParts.join("\n") : undefined,
	};
}

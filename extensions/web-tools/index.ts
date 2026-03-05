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
import { Type } from "@sinclair/typebox";

const TOOL_NAMES = ["web_search", "web_fetch"] as const;

export default function webToolsExtension(pi: ExtensionAPI) {
	let isAnthropicModel = false;
	let savedActiveTools: string[] | null = null;

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
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (ctx.model?.provider !== "anthropic") {
				return {
					content: [{ type: "text", text: "Error: web_search is only available with Anthropic models." }],
					isError: true,
				};
			}

			const apiKey = await ctx.modelRegistry.getApiKeyForProvider("anthropic");
			if (!apiKey) {
				return {
					content: [{ type: "text", text: "Error: No Anthropic API key configured." }],
					isError: true,
				};
			}

			try {
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
						tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 1 }],
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
					};
				}

				const data = await response.json();
				const results = extractSearchResults(data);

				return {
					content: [{ type: "text", text: results }],
					details: { query: params.query },
				};
			} catch (err: any) {
				if (err.name === "AbortError") {
					return { content: [{ type: "text", text: "Search cancelled." }] };
				}
				return {
					content: [{ type: "text", text: `Error: ${err.message}` }],
					isError: true,
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
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (ctx.model?.provider !== "anthropic") {
				return {
					content: [{ type: "text", text: "Error: web_fetch is only available with Anthropic models." }],
					isError: true,
				};
			}

			const apiKey = await ctx.modelRegistry.getApiKeyForProvider("anthropic");
			if (!apiKey) {
				return {
					content: [{ type: "text", text: "Error: No Anthropic API key configured." }],
					isError: true,
				};
			}

			try {
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
						tools: [{ type: "web_fetch_20260209", name: "web_fetch" }],
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
					};
				}

				const data = await response.json();
				const content = extractFetchContent(data);

				return {
					content: [{ type: "text", text: content }],
					details: { url: params.url },
				};
			} catch (err: any) {
				if (err.name === "AbortError") {
					return { content: [{ type: "text", text: "Fetch cancelled." }] };
				}
				return {
					content: [{ type: "text", text: `Error: ${err.message}` }],
					isError: true,
				};
			}
		},
	});
}

/**
 * Extract search results from an Anthropic Messages API response that used web_search.
 * The response contains tool_use and tool_result blocks with search results.
 */
function extractSearchResults(data: any): string {
	const parts: string[] = [];

	for (const block of data.content ?? []) {
		// Server tool results appear as content blocks
		if (block.type === "web_search_tool_result") {
			for (const result of block.content ?? []) {
				if (result.type === "web_search_result") {
					parts.push(`### ${result.title}\n${result.url}\n${result.encrypted_content ?? result.page_content ?? result.snippet ?? ""}\n`);
				}
			}
		}
		// Also capture any text summary the model produces
		if (block.type === "text" && block.text) {
			parts.push(block.text);
		}
	}

	return parts.length > 0 ? parts.join("\n") : "No search results found.";
}

/**
 * Extract fetched page content from an Anthropic Messages API response that used web_fetch.
 */
function extractFetchContent(data: any): string {
	const parts: string[] = [];

	for (const block of data.content ?? []) {
		if (block.type === "web_fetch_tool_result") {
			if (block.content) {
				// content can be a string or array
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
		}
	}

	return parts.length > 0 ? parts.join("\n") : "No content fetched.";
}

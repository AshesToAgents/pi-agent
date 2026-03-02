import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const OTHER_LABEL_BASE = "Other (enter custom text)";

type AskUserDetails = {
	question: string;
	selected: string;
	isCustom: boolean;
	options: string[];
	allowCustom: boolean;
};

function uniqueOtherLabel(options: string[]): string {
	let label = OTHER_LABEL_BASE;
	let i = 2;
	while (options.includes(label)) {
		label = `${OTHER_LABEL_BASE} ${i}`;
		i++;
	}
	return label;
}

export default function askUserExtension(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => {
		const askUserPrompt =
			"## Ask User Tool\nThe `askUser` tool should be preferred whenever possible for asking the user questions instead of requesting the user to answer in plain text.";
		return {
			systemPrompt: `${event.systemPrompt}\n\n${askUserPrompt}`,
		};
	});

	pi.registerTool({
		name: "askUser",
		label: "Ask User",
		description:
			"Ask the user a multiple-choice question in the Pi TUI. Includes predefined options plus a final custom-text option.",
		parameters: Type.Object({
			question: Type.String({ description: "Question to show the user" }),
			options: Type.Array(Type.String(), {
				description: "Predefined options shown in the selection prompt",
			}),
			allowCustom: Type.Optional(
				Type.Boolean({
					description: "Allow custom text entry as the final option. Defaults to true.",
					default: true,
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const question = params.question?.trim();
			const options = (params.options ?? []).map((o) => o?.trim()).filter(Boolean) as string[];
			const allowCustom = params.allowCustom ?? true;

			const baseDetails: AskUserDetails = {
				question: question ?? "",
				selected: "",
				isCustom: false,
				options,
				allowCustom,
			};

			if (!question) {
				return {
					content: [{ type: "text", text: "Error: question must be a non-empty string." }],
					details: baseDetails,
					isError: true,
				};
			}

			if (options.length === 0) {
				return {
					content: [{ type: "text", text: "Error: options must contain at least one non-empty option." }],
					details: baseDetails,
					isError: true,
				};
			}

			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: "Error: askUser requires interactive UI mode." }],
					details: baseDetails,
					isError: true,
				};
			}

			const otherLabel = uniqueOtherLabel(options);
			const selectable = allowCustom ? [...options, otherLabel] : [...options];
			const choice = await ctx.ui.select(question, selectable);

			if (!choice) {
				return {
					content: [{ type: "text", text: "Error: question was canceled by the user." }],
					details: baseDetails,
					isError: true,
				};
			}

			if (allowCustom && choice === otherLabel) {
				while (true) {
					const custom = await ctx.ui.input(question, "Enter your custom answer");
					if (custom === undefined) {
						return {
							content: [{ type: "text", text: "Error: custom answer entry was canceled by the user." }],
							details: { ...baseDetails, isCustom: true },
							isError: true,
						};
					}

					const trimmed = custom.trim();
					if (!trimmed) {
						ctx.ui.notify("Custom answer cannot be empty. Please enter a value.", "warning");
						continue;
					}

					return {
						content: [{ type: "text", text: `User selected custom answer: ${trimmed}` }],
						details: { ...baseDetails, selected: trimmed, isCustom: true },
					};
				}
			}

			return {
				content: [{ type: "text", text: `User selected option: ${choice}` }],
				details: { ...baseDetails, selected: choice, isCustom: false },
			};
		},
		renderCall(args, theme) {
			const options = Array.isArray(args.options) ? args.options.length : 0;
			const allowCustom = args.allowCustom ?? true;
			const text =
				theme.fg("toolTitle", theme.bold("askUser")) +
				theme.fg("dim", ` (${options} option${options === 1 ? "" : "s"}${allowCustom ? " + custom" : ""})`);
			return new Text(text, 0, 0);
		},
		renderResult(result, _options, theme) {
			const details = (result.details ?? {}) as Partial<AskUserDetails>;
			const question = details.question?.trim();
			const selected = details.selected ?? "";
			const isCustom = Boolean(details.isCustom);

			if (question) {
				if (result.isError) {
					const text =
						theme.fg("error", "✗ askUser") +
						`\n${theme.fg("muted", "Q:")} ${question}` +
						`\n${theme.fg("error", "Canceled or failed")}`;
					return new Text(text, 0, 0);
				}

				const answerLine =
					theme.fg("muted", "A:") +
					" " +
					(isCustom
						? theme.fg("accent", `${selected} ${theme.fg("dim", "(custom)")}`)
						: theme.fg("accent", selected));

				const text = theme.fg("success", "✓ askUser") + `\n${theme.fg("muted", "Q:")} ${question}\n${answerLine}`;
				return new Text(text, 0, 0);
			}

			const contentText = result.content.find((c) => c.type === "text");
			return new Text(contentText?.type === "text" ? contentText.text : "askUser completed", 0, 0);
		},
	});
}

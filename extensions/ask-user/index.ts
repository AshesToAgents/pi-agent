import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, Input, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const OTHER_LABEL_BASE = "Other (enter custom text)";

type AskUserDetails = {
	question: string;
	selected: string;
	isCustom: boolean;
	options: string[];
	allowCustom: boolean;
};

type SelectResult =
	| { type: "selected"; value: string }
	| { type: "edit"; value: string }
	| null;

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
	if (process.env.PI_NO_ASK_USER) return;

	pi.registerTool({
		name: "askUser",
		label: "Ask User",
		description:
			"Ask the user a multiple-choice question in the Pi TUI. Includes predefined options plus a final custom-text option.",
		promptSnippet: "Ask the user a multiple-choice question in the Pi TUI",
		promptGuidelines: [
			"Prefer the askUser tool whenever possible for asking the user questions instead of requesting plain-text replies.",
		],
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
		async execute(toolCallId, params, _signal, _onUpdate, ctx) {
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

			pi.events.emit("ask-user:tool-called", {
				toolCallId,
				question: baseDetails.question,
				options: baseDetails.options,
				allowCustom: baseDetails.allowCustom,
			});

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

			// Custom select with 'e' key support to edit an option
			const selectResult = await ctx.ui.custom<SelectResult>((tui, theme, _kb, done) => {
				const container = new Container();

				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
				container.addChild(new Text(theme.fg("accent", ` ${question}`), 0, 0));
				container.addChild(new Text("", 0, 0)); // spacer

				const items: SelectItem[] = selectable.map((opt) => ({
					value: opt,
					label: opt,
				}));

				const selectList = new SelectList(items, Math.min(items.length, 15), {
					selectedPrefix: (t) => theme.fg("accent", t),
					selectedText: (t) => theme.fg("accent", t),
					description: (t) => theme.fg("muted", t),
					scrollInfo: (t) => theme.fg("dim", t),
					noMatch: (t) => theme.fg("warning", t),
				});
				selectList.onSelect = (item) => done({ type: "selected", value: item.value });
				selectList.onCancel = () => done(null);
				container.addChild(selectList);

				const hints = ["↑↓ navigate", "enter select", "esc cancel"];
				if (allowCustom) {
					hints.push("e edit option");
				}
				container.addChild(new Text(theme.fg("dim", ` ${hints.join(" • ")}`), 0, 0));
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

				return {
					render: (w) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data) => {
						// Intercept 'e' key to edit the highlighted option
						if (allowCustom && data === "e") {
							const selected = selectList.getSelectedItem();
							if (selected && selected.value !== otherLabel) {
								done({ type: "edit", value: selected.value });
								return;
							}
						}
						selectList.handleInput(data);
						tui.requestRender();
					},
				};
			});

			if (!selectResult) {
				pi.events.emit("ask-user:canceled", {
					toolCallId,
					question,
					options,
					allowCustom,
					stage: "select",
				});

				return {
					content: [{ type: "text", text: "Error: question was canceled by the user." }],
					details: baseDetails,
					isError: true,
				};
			}

			// Direct selection of a regular option
			if (selectResult.type === "selected" && selectResult.value !== otherLabel) {
				pi.events.emit("ask-user:answered", {
					toolCallId,
					question,
					selected: selectResult.value,
					isCustom: false,
					options,
					allowCustom,
				});

				return {
					content: [{ type: "text", text: `User selected option: ${selectResult.value}` }],
					details: { ...baseDetails, selected: selectResult.value, isCustom: false },
				};
			}

			// Custom input mode: either "Other" was selected or 'e' was pressed
			const prefill = selectResult.type === "edit" ? selectResult.value : "";

			while (true) {
				const custom = await showCustomInput(ctx, question, prefill);
				if (custom === undefined) {
					pi.events.emit("ask-user:canceled", {
						toolCallId,
						question,
						options,
						allowCustom,
						stage: "custom-input",
					});

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

				pi.events.emit("ask-user:answered", {
					toolCallId,
					question,
					selected: trimmed,
					isCustom: true,
					options,
					allowCustom,
				});

				return {
					content: [{ type: "text", text: `User selected custom answer: ${trimmed}` }],
					details: { ...baseDetails, selected: trimmed, isCustom: true },
				};
			}
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

/** Show a custom input dialog with optional pre-filled text. Returns undefined on cancel. */
async function showCustomInput(
	ctx: { ui: { custom: <T>(factory: (tui: any, theme: any, kb: any, done: (value: T) => void) => any, opts?: any) => Promise<T> } },
	title: string,
	prefill: string,
): Promise<string | undefined> {
	return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
		const container = new Container();

		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		container.addChild(new Text(theme.fg("accent", ` ${title}`), 0, 0));
		container.addChild(new Text("", 0, 0)); // spacer

		const input = new Input();
		input.onSubmit = (value) => done(value);
		input.onEscape = () => done(undefined);

		if (prefill) {
			input.setValue(prefill);
			// setValue clamps cursor to 0; move it to end of text
			(input as any).cursor = prefill.length;
		}

		container.addChild(input);

		container.addChild(new Text("", 0, 0)); // spacer
		container.addChild(new Text(theme.fg("dim", " enter submit • esc cancel"), 0, 0));
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render: (w) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data) => {
				input.handleInput(data);
				tui.requestRender();
			},
			// Focusable: propagate to input for IME cursor positioning
			get focused() {
				return input.focused;
			},
			set focused(value: boolean) {
				input.focused = value;
			},
		};
	});
}

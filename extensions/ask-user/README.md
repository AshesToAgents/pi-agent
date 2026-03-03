# ask-user extension

Adds an `askUser` tool for interactive user questions in the Pi TUI.

## Tool

### `askUser`

Parameters:
- `question: string`
- `options: string[]`
- `allowCustom?: boolean` (default: `true`)

Behavior:
1. Shows a TUI selection prompt with predefined options.
2. If `allowCustom` is true, appends a final option: `Other (enter custom text)`.
3. If the user selects `Other`, opens a text input prompt.
4. Returns the selected value and whether it was custom.

Return details shape:

```ts
{
  question: string;
  selected: string;
  isCustom: boolean;
  options: string[];
  allowCustom: boolean;
}
```

## Example tool call

```json
{
  "question": "Which deployment target should we use?",
  "options": ["staging", "production"],
  "allowCustom": true
}
```

## Events

The extension emits the following events:

### `ask-user:tool-called`
Emitted whenever the tool is invoked, immediately after parameters are normalized.

Payload schema:

```ts
{
  toolCallId: string;
  question: string;
  options: string[];
  allowCustom: boolean;
}
```

### `ask-user:answered`
Emitted when the user successfully submits an answer (predefined option or custom text).

Payload schema:

```ts
{
  toolCallId: string;
  question: string;
  selected: string;
  isCustom: boolean;
  options: string[];
  allowCustom: boolean;
}
```

### `ask-user:canceled`
Emitted when the user cancels either the selection dialog or the custom input dialog.

Payload schema:

```ts
{
  toolCallId: string;
  question: string;
  options: string[];
  allowCustom: boolean;
  stage: "select" | "custom-input";
}
```

### Listener Example

Other extensions can listen to these events using the `pi.events.on(...)` API:

```ts
pi.events.on("ask-user:tool-called", (payload) => {
  console.log("AskUser tool invoked:", payload.question);
});

pi.events.on("ask-user:answered", (payload) => {
  console.log("AskUser answered:", payload.selected, "custom:", payload.isCustom);
});

pi.events.on("ask-user:canceled", (payload) => {
  console.log("AskUser canceled at stage:", payload.stage);
});
```

## Notes

- Requires interactive UI mode (`ctx.hasUI === true`).
- In non-interactive mode, the tool returns an error.
- If custom input is empty, the prompt is shown again.
- Validation errors (empty question/options, missing UI) are not treated as user cancel events.

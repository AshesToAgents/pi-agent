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
  selected: string;
  isCustom: boolean;
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

## Notes

- Requires interactive UI mode (`ctx.hasUI === true`).
- In non-interactive mode, the tool returns an error.
- If custom input is empty, the prompt is shown again.

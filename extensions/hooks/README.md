# hooks extension

Claude Code-style lifecycle hooks for Pi.

This extension lets you run **shell commands** or **HTTP webhooks** at key lifecycle points (session start/end, tool calls, prompt submission, etc.). Hooks are configured in JSON files and can:

- block tool calls or prompt submission,
- inject additional context,
- request session stop.

---

## Config files

Two scopes are supported and merged:

- Global: `~/.pi/agent/hooks.json`
- Project: `<cwd>/.pi/hooks.json`

Project hooks are appended after global hooks per event.

If either file has `"disableAllHooks": true`, hooks are disabled effectively.

---

## Config format

```json
{
  "disableAllHooks": false,
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "bash",
        "hooks": [
          {
            "type": "command",
            "command": ".pi/hooks/block-rm.sh",
            "timeout": 30
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "write|edit",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:8080/hooks/post-tool",
            "timeout": 10,
            "headers": {
              "Authorization": "Bearer $MY_TOKEN"
            },
            "allowedEnvVars": ["MY_TOKEN"]
          }
        ]
      }
    ]
  }
}
```

### Matcher behavior

- `matcher` is a regex against tool name for tool-related events.
- `"*"`, empty, or omitted matcher means “match all”.

Examples:
- `"bash"`
- `"write|edit"`

---

## Supported hook events

| Hook Event | Pi Event |
|---|---|
| `SessionStart` | `session_start` |
| `SessionEnd` | `session_shutdown` |
| `PreToolUse` | `tool_call` |
| `PostToolUse` | `tool_result` (`isError === false`) |
| `PostToolUseFailure` | `tool_result` (`isError === true`) |
| `Stop` | `agent_end` |
| `UserPromptSubmit` | `input` |
| `PreCompact` | `session_before_compact` |

---

## Hook handler types

### 1) Command hook

```json
{
  "type": "command",
  "command": "./my-hook.sh",
  "timeout": 30,
  "async": false
}
```

Behavior:
- JSON input is written to stdin.
- Exit `0` => success
- Exit `2` => block (where applicable)
- Other exit codes => non-blocking error

Environment variables set for command hooks:
- `PI_PROJECT_DIR=<cwd>`
- `CLAUDE_PROJECT_DIR=<cwd>` *(alias for Claude Code compatibility)*

`async: true` is fire-and-forget (does not block execution).

### 2) HTTP hook

```json
{
  "type": "http",
  "url": "http://localhost:8080/hooks",
  "timeout": 10,
  "headers": {
    "Authorization": "Bearer $TOKEN"
  },
  "allowedEnvVars": ["TOKEN"]
}
```

Behavior:
- Sends POST with JSON body.
- 2xx => success.
- Non-2xx/timeout/network failures => non-blocking error.
- Header env interpolation only applies to allowed variables.

---

## Hook input payload

All hooks receive common fields:

```json
{
  "session_id": "...",
  "cwd": "/path/to/project",
  "hook_event_name": "PreToolUse"
}
```

Event-specific fields are included when relevant, e.g.:
- `tool_name`, `tool_input`, `tool_call_id`, `tool_response`, `error`
- `prompt`, `source`, `images`

### Claude Code compatibility: `tool_input.file_path`

Pi tools typically use a `path` parameter (often relative), while Claude Code hooks expect `file_path` (absolute). To bridge this, the extension **automatically adds a `file_path` field** to `tool_input` for tool-related events (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`) when:

- `tool_input.path` exists and is a string, **and**
- `tool_input.file_path` is not already present.

The injected `file_path` is always resolved to an absolute path against `cwd`. This means hooks written for Claude Code that inspect `tool_input.file_path` will work out of the box with Pi.

Example — a Pi `Read` tool call with `{"path": "src/main.ts"}` becomes:

```json
{
  "tool_name": "Read",
  "tool_input": {
    "path": "src/main.ts",
    "file_path": "/Users/you/project/src/main.ts"
  }
}
```

---

## Hook output payload

Hook stdout (command) or response body (HTTP) can return JSON:

```json
{
  "continue": true,
  "decision": "block",
  "reason": "Not allowed",
  "stopReason": "Stopping session",
  "additionalContext": "Extra instruction for agent",
  "hookSpecificOutput": {
    "permissionDecision": "deny",
    "permissionDecisionReason": "Denied by policy"
  }
}
```

Recognized behavior:

- `continue: false` => request session shutdown.
- `decision: "block"` (for `UserPromptSubmit`) => blocks prompt.
- `hookSpecificOutput.permissionDecision: "deny"` (for `PreToolUse`) => blocks tool call.
- `additionalContext` (or `hookSpecificOutput.additionalContext`) => injected into downstream flow.

---

## Blocking semantics

- `PreToolUse`: can block.
- `UserPromptSubmit`: can block.
- Other events: non-blocking (but can add context and request stop).

When multiple hooks match, the first block reason encountered wins.

---

## `/hooks` command

Interactive manager (UI mode only):

- View hooks
- Add hook
- Delete hook
- Toggle `disableAllHooks` (global/project)

In non-UI mode, `/hooks` is a no-op with a warning.

---

## Claude Code compatibility

This extension is designed to be compatible with hooks written for Claude Code. The main compatibility shims are:

| Claude Code convention | Pi equivalent | Bridged by extension |
|---|---|---|
| `CLAUDE_PROJECT_DIR` env var | `PI_PROJECT_DIR` | Both are set to `cwd` for command hooks |
| `tool_input.file_path` (absolute) | `tool_input.path` (often relative) | `file_path` is auto-added as an absolute path when `path` is present |
| Hook event names (`PreToolUse`, etc.) | Pi events (`tool_call`, etc.) | Extension maps Pi events to Claude Code hook event names |
| Exit code `2` = block | Same | Supported identically |
| `hookSpecificOutput.permissionDecision` | N/A in Pi natively | Recognized and applied by the extension |

In most cases, hooks targeting Claude Code will work with Pi without modification.

---

## Notes and limitations

- Malformed `hooks.json` files are skipped with warnings (extension keeps running).
- `updatedInput` from `PreToolUse` is currently not applied (Pi `tool_call` does not support input mutation yet).
- Async command hooks (`async: true`) are not awaited and cannot block.

---

## Quick start

1. Add this extension under `~/.pi/agent/extensions/hooks/` (already in this repo).
2. Create `~/.pi/agent/hooks.json` or `.pi/hooks.json`.
3. Reload Pi runtime (`/reload`) or restart Pi.
4. Use `/hooks` to inspect/manage configuration interactively.

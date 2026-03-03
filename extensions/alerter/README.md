# alerter extension

Sends native desktop notifications through the external `alerter` CLI for:

- `askUser` prompts (agent is waiting for your answer)
- task completion (`agent_end`, agent is waiting for your next input)

## Requirements

Install `alerter` and ensure it is available on `PATH`.

## Behavior

### Ask User notifications

- On `ask-user:tool-called`, shows:
  - title: `Pi Agent`
  - message: `The agent is asking you a question!`
  - group: `pi:<sessionId>:ask-user`
- On `ask-user:answered` or `ask-user:canceled`, removes that group notification.

### Task finished notifications

- On `agent_end`, shows:
  - title: `Pi Agent`
  - message: `Task finished! Waiting for your input.`
  - group: `pi:<sessionId>:task-finished`
- On `before_agent_start`, `session_shutdown`, `session_before_switch`, and `session_before_fork`, removes that group notification.

## Notes

- `pi.exec("alerter", ...)` is intentionally non-blocking (not awaited).
- All `pi.exec` calls use `.catch(...)` to ignore failures (e.g. missing `alerter`).
- Notifications are only shown when UI is available (`ctx.hasUI`), but dismiss calls still run.

## File

- `extensions/alerter/index.ts`

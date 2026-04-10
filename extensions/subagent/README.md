# Subagent Extension

Delegate tasks to specialized subagents with isolated contexts.

## Quick Start

Three modes:

- **Single**: delegate to one agent
  ```typescript
  subagent({ agent: "coder", task: "Implement login" })
  ```

- **Parallel**: run multiple tasks simultaneously
  ```typescript
  subagent({
    tasks: [
      { agent: "researcher", task: "Find React best practices" },
      { agent: "designer", task: "Create wireframes" }
    ]
  })
  ```

- **Chain**: sequential tasks with shared context
  ```typescript
  subagent({
    chain: [
      { agent: "planner", task: "Outline blog post" },
      { agent: "writer", task: "Write based on: {previous}" }
    ]
  })
  ```

- **Discover agent metadata** (LLM can call this itself)
  ```typescript
  subagent_agents({ agentScope: "all" })                 // default: summary (name + description)
  subagent_agents({ agentScope: "project", detail: "full" })
  ```

## Agent Discovery

Agents are discovered from:

- User agents: `~/.pi/agent/agents/`
- Project agents: `.pi/agents/` in the current project tree
- Package agents: `agents/` dirs in installed pi packages (via convention or `pi.agents` manifest)

Control this via `agentScope`:

- `"all"` (default): user + project + package agents (later sources override on name conflicts)
- `"user"`: user agents only
- `"project"`: project agents only
- `"package"`: package agents only

The extension injects a compact agent overview into `before_agent_start` using only **top-level** agent files (name + description).
If the model needs more detail (including nested agent files), it can call `subagent_agents`.

For users, `/subagents` provides the same discovery output in-session:

```text
/subagents                  # all + summary (default)
/subagents project full     # project scope with full metadata
/subagents user summary
```

## Agent Configuration

Agents are Markdown files with a YAML frontmatter header. Supported fields:

| Field         | Required | Description                                      |
|---------------|----------|--------------------------------------------------|
| `name`        | ✓        | Agent name (used to invoke via `subagent`)       |
| `description` | ✓        | Short description shown in agent overviews       |
| `model`       |          | Model to use (see Model Aliases below)           |
| `tools`       |          | Comma-separated tool allowlist (default: all)    |

Example agent file:

```markdown
---
name: planner
description: Creates implementation plans from requirements
model: fast
tools: read, bash
---

You are a planning agent. Given a task, produce a clear step-by-step plan.
```

### Model Aliases

The `model` field in agent frontmatter supports the following values:

- `parent` — use the same model as the calling (parent) agent
- `fast` — use the model configured as the "fast" tier alias (see `/subagent-models`)
- `smart` — use the model configured as the "smart" tier alias
- `provider/modelId` — explicit model, e.g. `anthropic/claude-3-5-haiku-20241022`
- `modelId` — bare model ID, resolved under the current provider

If omitted, the default pi model is used.

### Configuring Model Aliases

Use the `/subagent-models` command to configure the `fast` and `smart` tier aliases:

```text
/subagent-models
```

This opens an interactive prompt to select a model for each tier. Aliases are stored in `~/.pi/agent/settings.json`. Both default to `parent` (inherit from calling agent) if not configured.

## Parameters

### `subagent` tool

| Parameter            | Type      | Description                                                                 |
|----------------------|-----------|-----------------------------------------------------------------------------|
| `agent`              | string    | Agent name (single mode)                                                    |
| `task`               | string    | Task to delegate (single mode)                                              |
| `cwd`                | string    | Working directory for the agent process (single mode)                       |
| `tasks`              | array     | `{ agent, task, cwd? }` items for parallel mode (max 8, concurrency 4)     |
| `chain`              | array     | `{ agent, task, cwd? }` items for chain mode; use `{previous}` placeholder |
| `agentScope`         | string    | `"all"` \| `"user"` \| `"project"` \| `"package"` (default: `"all"`) |
| `confirmProjectAgents` | boolean | Prompt before running project-local agents (default: `true`)               |

### `subagent_agents` tool

| Parameter    | Type   | Description                                                        |
|--------------|--------|--------------------------------------------------------------------|
| `agentScope` | string | `"all"` \| `"user"` \| `"project"` \| `"package"` (default: `"all"`) |
| `detail`     | string | `"summary"` (name + description) \| `"full"` (all metadata)       |

## Security Model

Subagents run as child `pi` processes.

- **Built-in tools** (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) are controlled by existing tool allowlists (`agent.tools` / `--tools`).
- **Extension tools** are controlled by `--extension-tools`.
- In subagent child processes, extension tools are **denied by default** unless explicitly allowlisted.
- This includes the `subagent` tool itself (recursive subagent calls are blocked unless allowlisted).

### `--extension-tools`

Comma-separated list of extension tool names allowed in subagent children.

- Empty (default): allow none
- Example: `--extension-tools subagent,my_custom_tool`
- `all` can be used to allow all extension tools

### Project Agent Confirmation

When `confirmProjectAgents` is `true` (the default) and a UI is available, the user is prompted before any project-local agent runs. This guards against running repo-controlled agent definitions from untrusted repositories.

## Examples

Default deny-all extension tools in children:

```bash
pi
```

Allow only the `subagent` extension tool in children:

```bash
pi --extension-tools subagent
```

Allow multiple extension tools in children:

```bash
pi --extension-tools subagent,my_custom_tool
```

## Notes

- Child runs rely on normal extension auto-loading (no explicit `-e` injection).
- If your environment disables extension loading, `subagent` child guard logic will not run.
- Parallel mode caps at 8 tasks total and 4 concurrent processes.

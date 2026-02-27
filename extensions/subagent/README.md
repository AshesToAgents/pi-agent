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

## Agent Discovery

Agents are discovered from:

- User agents: `~/.pi/agent/agents/`
- Project agents: `.pi/agents/` in the current project tree

Control this via `agentScope`:

- `"user"` (default): user agents only
- `"project"`: project agents only
- `"both"`: load both (project overrides on name conflicts)

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

# Subagent Extension - Maintenance Guide

## Core Architecture

The extension has two main files:
- `index.ts` (650 lines): Main logic with three modes (single, parallel, chain)
- `agents.ts` (150 lines): Agent discovery and configuration

## Key Components

### Process Management
- Spawns child `pi` processes with JSON streaming
- Handles graceful termination via AbortSignal
- Manages temporary files securely

### Model Resolution
- Supports aliases: "parent", "fast", "smart"
- Falls back to provider-specific models
- Can use bare model IDs or full "provider/model" strings

### Result Tracking
Tracks: input/output tokens, cache operations, cost, context usage, turn counts

### UI Integration
- Collapsible views (Ctrl+O to expand)
- Color-coded status indicators
- Token usage displays
- Tool call visualizations

## Extending

### Adding a New Mode
1. Add to `SubagentParams` schema
2. Implement in main `execute()` function
3. Add rendering logic to `renderCall()` and `renderResult()`
4. Update tool description

### Modifying Agent Discovery
1. Edit `discoverAgents()` in agents.ts
2. Add new directories/file patterns
3. Update agent configuration parsing
4. Ensure backward compatibility

## Best Practices
- Maintain mode isolation
- Preserve streaming for real-time updates
- Handle errors gracefully with useful messages
- Respect Abort Signals and clean up resources
- Test concurrency for parallel operations

## Debugging Tips
1. Check child process stderr output
2. Verify JSON streaming works correctly
3. Ensure temporary files are cleaned up
4. Test with different model configurations
5. Validate agent discovery finds all expected agents

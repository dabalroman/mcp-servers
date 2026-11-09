# mcp-servers

MCP servers for [Claude Code](https://claude.ai/code).

## Servers

| Server | Description |
|---|---|
| [simple-task-manager](simple-task-manager/README.md) | Persistent file-based task tracker |

The task manager's skills and full usage rules install as a Claude Code plugin.

## Plugins

Add the marketplace once: `/plugin marketplace add dabalroman/mcp-servers`

| Plugin | Description | Install |
|---|---|---|
| tm | Skills and full usage rules for the simple-task-manager MCP | `/plugin install tm@dabalroman` |
| active-model | Shows the active model, context fill and current task in a band above the prompt | `/plugin install active-model@dabalroman` |

`active-model` shows the task line only where the task-manager MCP is connected: it reads the current `in_progress` task and the open count from that server, and follows `setStatus`/`add`/`delete` as the agent makes them.

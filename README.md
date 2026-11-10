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
| pr-watch | Watches the PRs of the session's tasks: PR statuses, deploy note, a turn on failed checks, comments and deploys | `/plugin install pr-watch@dabalroman` |

`active-model` shows the task line only where the task-manager MCP is connected: it reads the current `in_progress` task and the open count from that server, and follows `setStatus`/`add`/`update`/`delete` as the agent makes them, with the task's epic id and title before it.

`pr-watch` needs `gh` (logged in) and the task-manager MCP. It watches the PRs on the tasks of the current branch's JIRA id and on the tasks the agent works on (an epic brings its children), polls GitHub every minute, writes each PR's status (`draft` -> `open` -> `pipeline_pass` -> `approved` -> `merged` -> `deployed`, or `closed`) and one deploy note per PR, and starts a turn when a check fails, someone comments or the deploy workflow (`deployWorkflow` option, default `deploy-dev.yml`) finishes. Install it only where GitHub workflows run.

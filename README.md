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
| task-watch | Tells the session when another session or the UI changes its tasks: a toast, and a turn on status changes and notes | `/plugin install task-watch@dabalroman` |

`active-model` shows the task line only where the task-manager MCP is connected: it shows the `in_progress` task this session touched last (none until the session touches one), with its epic id and title before it, and the open count from that server, following the agent's task calls as it makes them.

`pr-watch` needs `gh` (logged in) and the task-manager MCP. It watches the PRs on the tasks of the current branch's JIRA id and on the tasks the agent works on (an epic brings its children), polls GitHub every minute, writes each PR's status (`draft` -> `open` -> `pipeline_pass` -> `approved` -> `merged` -> `deployed`, or `closed`) and one deploy note per PR, and starts a turn when a check fails, someone comments or the deploy workflow (`deployWorkflow` option, default `deploy-dev.yml`) finishes. A row above the prompt lists the PRs it watches and their state. Install it only where GitHub workflows run.

`task-watch` needs a task-manager server with `getUpdates`. It watches the tasks the agent works on (a task in an epic, or an epic, brings the whole epic), polls every minute, and toasts each change made outside the session; status changes and new or edited notes start a turn, other edits ride on the next prompt. The agent's own writes and `prs` changes are never reported. It only reads task-manager.

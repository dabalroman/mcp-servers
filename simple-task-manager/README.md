# simple-task-manager MCP

A persistent, file-based task manager exposed as an [MCP](https://modelcontextprotocol.io) server. Tasks live in two plain-text Markdown files that you can read and edit by hand. Claude Code reads these files to track work across sessions, survive compaction, and suggest what to do next.

## File format

Tasks are stored in `TASKS.md` (active) and `TASKS_DONE.md` (archived). Each task looks like:

```
# 42 Fix the auth bug
## bug | in_progress | high
Reproduction: log in with an expired token. The session is not invalidated.
Steps to fix: check the middleware in src/auth.ts.
```

The first line is the header (`# {id} {title}`), the second line is metadata (`## {type} | {status} | {priority}`), and the rest is the description. `TASKS.md` also has a `# Counter: N` line at the top that tracks the highest id ever issued.

**Types**: `bug` · `feature` · `idea` · `tool` · `other`  
**Priorities**: `low` · `medium` · `high` · `critical`  
**Statuses**: `todo` · `in_progress` · `done`

## Setup

### 1. Register in a project

Add `.mcp.json` to your project root (checked into git so teammates get it automatically):

```json
{
  "mcpServers": {
    "task-manager": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-servers/simple-task-manager/server.js"],
      "env": {
        "TASKS_FILE": "/absolute/path/to/project/TASKS.md",
        "TASKS_DONE_FILE": "/absolute/path/to/project/TASKS_DONE.md"
      }
    }
  }
}
```

`TASKS.md` and `TASKS_DONE.md` are created on first use — no need to pre-create them.

### 2. Install dependencies and git hook

```sh
cd simple-task-manager
npm install   # installs deps + wires up the pre-commit hook via prepare script
```

The `prepare` script writes `.git/hooks/pre-commit` so tests run automatically before every commit to this repo.

## Tools

| Tool | Description |
|---|---|
| `add` | Schedule a new task (type, priority, title, description). Returns `{ id }`. |
| `getNext` | The single next recommended task — answers "what's next?". Optional `type` filter. |
| `getAll` | All not-done tasks grouped by type, sorted by priority desc then id desc. |
| `getByType` | All tasks of one type across all statuses. |
| `getById` | One task by numeric id (searches both active and done). |
| `getOverview` | Count summary per type (total + actionable). |
| `setStatus` | Move a task between `todo` / `in_progress` / `done`. Automatically relocates the task between files. |
| `delete` | Permanently remove a task. Prefer `setStatus(done)` for completed work. |
| `cleanup` | Move all done tasks from `TASKS.md` to `TASKS_DONE.md` and rewrap long description lines. |

## Development

```sh
npm test      # run test suite once (node:test, no extra deps)
npm start     # start the MCP server (used by Claude Code via .mcp.json)
```

Tests cover `tasks.js` — the parser, writer, and sort helpers. The pre-commit hook runs `npm test` automatically.

## Prioritization guidance (for Claude Code)

When recommending the next task, prefer in this order:

1. `bug` — defects degrade the product; fix first
2. `tool` — developer tooling improvements compound; tackle when the bug list is clear
3. `feature` — planned work; usually requires a planning session before implementation
4. `idea` — exploratory; needs refinement before becoming a feature
5. `other` — case-by-case

Within each type: highest priority first, newest id first (FILO).

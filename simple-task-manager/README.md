# simple-task-manager MCP

A persistent, file-based task manager for [Claude Code](https://claude.ai/code), exposed as an [MCP](https://modelcontextprotocol.io) server. Tasks live in two plain Markdown files (`TASKS.md` / `TASKS_DONE.md`) that you can read and edit by hand. Claude uses them to track work across sessions, survive context compaction, and suggest what to do next.

**No separate Claude instructions needed** — behavioral rules are embedded in the server and loaded automatically when Claude connects.

---

## Prerequisites

- **Node.js 18 or later** — check with `node --version`. Download from [nodejs.org](https://nodejs.org) if not installed.
- **Claude Code** — the CLI or desktop app.

---

## Quick Start

### Step 1 — Clone and install

```sh
git clone https://github.com/dabalroman/mcp-servers ~/.claude/mcp-servers
cd ~/.claude/mcp-servers/simple-task-manager
npm install
```

### Step 2 — One-time global setup

```sh
node ~/.claude/mcp-servers/simple-task-manager/install.js --global
```

This adds one line to `~/.claude/CLAUDE.md` so Claude knows how to register the MCP in any project.

### Step 3 — Register in a project

Open Claude Code in any project and say:

> "Set up the task manager for me"

Claude will run the installer, write `.mcp.json` with the correct paths, and tell you to restart. **Commit `.mcp.json` to git** so teammates get the same setup automatically.

### Step 4 — Approve and go

Restart Claude Code. On first launch it will prompt:

```
Allow MCP server "task-manager" to run?
```

Approve it. Then try it — say `"What should I work on next?"`

---

## How Claude behaves

### Scheduling discipline

Claude distinguishes between *scheduling* and *implementing*. If you say "TODO X", "schedule X", "add X to the list", "BUG X", or "FEATURE X" — Claude will call `add` and stop. It will not also implement the thing. If you mention a bug or feature while working on something else, Claude will ask whether to schedule it before continuing.

At the end of a task or session, Claude will suggest what to do next via `getNext`.

### User prefixes

You can prefix any message to signal intent:

| Prefix | Task type | Default behaviour |
|---|---|---|
| `BUG` | `bug` | Scheduled at high priority; surfaced before features |
| `TODO` / `SCHEDULE` | `tool` or `feature` | Scheduled as near-term work |
| `FEATURE` | `feature` | Scheduled; requires a planning session before implementation starts |
| `IDEA` | `idea` | Scheduled as exploratory; needs refinement before becoming a feature |

### Task lifecycle

1. Calls `setStatus(id, 'in_progress')` **before** starting any work.
2. Calls `setStatus(id, 'done')` **after** the commit is made and you confirm it — never before.
3. Only calls `delete` when you explicitly ask to cancel a task.

### Prioritization

When you ask "what's next?", Claude recommends in this order:

1. `bug` — defects first
2. `tool` — developer tooling compounds
3. `feature` — planned work
4. `idea` — exploratory, needs refinement
5. `other` — case-by-case

Within each type: highest priority first, newest id first.

### Workflow pipeline

1. **Schedule** — out-of-scope requests go to `add`, not inline implementation
2. **Plan** — for features: write a plan document before touching any code
3. **Implement** — reads relevant files first; no speculative changes
4. **Build** — must succeed with zero errors
5. **Test** — verifies end-to-end; waits for your confirmation
6. **Commit** — stages files, writes a clear commit message
7. **Next** — suggests what to do next

---

## File format

```
# 42 Fix the auth bug
## bug | in_progress | high
$scope: auth
$ref: #3 depends on | #9 blocked by
Reproduction: log in with an expired token. The session is not invalidated.
```

- Line 1: `# {id} {title}`
- Line 2: `## {type} | {status} | {priority}`
- Optional `$scope:` — area or tool the task belongs to
- Optional `$ref:` — related tasks as `#id note | #id note …`
- Remaining lines: free-text description

`TASKS.md` has a `# Counter: N` header tracking the highest id ever issued. Prefer using the MCP tools over editing these files by hand. If you do edit by hand, ask Claude to run `cleanup` afterwards.

**Types**: `bug` · `feature` · `idea` · `tool` · `other`  
**Priorities**: `low` · `medium` · `high` · `critical`  
**Statuses**: `todo` · `in_progress` · `done`

---

## Tools

These are called by Claude — you don't type them yourself.

| Tool | What it does |
|---|---|
| `add` | Schedule a new task. Required: `type`, `priority`, `title`, `description`. Optional: `scope`, `refs`. Returns the new `id`. |
| `update` | Edit any field of an existing task in place. Pass `null` to clear `scope` or `refs`. Works on active and done tasks. |
| `setStatus` | Move a task: `todo` → `in_progress` → `done`. `done` automatically archives it to `TASKS_DONE.md`. |
| `getNext` | The single recommended next task — answers "what's next?". |
| `getAll` | All not-done tasks grouped by type. |
| `getByType` | All tasks of one type across all statuses, including done. |
| `getByScope` | All tasks tagged with a specific scope (exact, case-sensitive). |
| `getById` | One task by its number — searches both active and done. |
| `getRelated` | Tasks that reference a given id (`inbound`) and tasks it references (`outbound`). |
| `getOverview` | Count summary per type: total and actionable. |
| `delete` | Permanently remove a task. Only use when asked — prefer `setStatus(done)` for finished work. |
| `cleanup` | Archive done tasks from `TASKS.md` to `TASKS_DONE.md` and rewrap long lines. |

### Refs — linking related tasks

Pass `refs: [{ id, note }]` to `add` or `update` to link tasks. The `note` describes the relationship: `"depends on"`, `"blocked by"`, `"see also"`, `"replaces"`. Use `getRelated(id)` to query connections.

### Scope — tagging tasks to an area

Set `scope` on tasks belonging to a specific tool or area (e.g. `"auth"`, `"api"`). Omit for project-wide tasks. Query with `getByScope("auth")` — exact, case-sensitive match.

---

## Troubleshooting

**Claude doesn't see the MCP tools**  
Make sure you approved the server when prompted. Restart the Claude Code session — the approval prompt reappears if the server isn't approved yet.

**`node: command not found`**  
Node.js isn't installed or isn't in PATH. Install from [nodejs.org](https://nodejs.org), then re-run `npm install`.

**Tasks aren't persisting between sessions**  
Check that the `TASKS_FILE` path in `.mcp.json` is absolute and points to a real location (not a placeholder).

**The server fails to start**  
Run `node server.js` directly from the `simple-task-manager` directory and read the error. The most common cause is a missing or wrong `TASKS_FILE` environment variable.

---

## Development

```sh
npm test
npm start     # Claude Code does this automatically via .mcp.json
```

The `prepare` script installs a pre-commit hook so `npm test` runs before every commit.

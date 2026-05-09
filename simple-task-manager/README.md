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

Approve it. Then try some prompts:

**Scheduling**
- `"Schedule a bug, high priority: when the user closes the window, unsaved text is lost"`
- `"Add an idea: dark mode support"`
- `"TODO: write tests for the auth module"`

**Working**
- `"What should I work on next?"`
- `"Do we have any bugs to solve?"`
- `"Do task #15"`
- `"List all tasks"`

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

1. New tasks **always** default to `refinement` — even when the task feels small or obvious. Claude acts as project manager: asks you clarifying questions, enriches the description via `update()`, then promotes to `todo` via `setStatus` when ready. Claude is allowed to skip refinement (pass `status: 'todo'` to `add`) **only** when (a) you explicitly ask for it ("schedule as todo", "no refinement needed"), or (b) refinement just happened in the current conversation. Otherwise the field stays at the default.
2. Calls `setStatus(id, 'in_progress')` **before** starting any work.
3. Calls `setStatus(id, 'done')` **after** the commit is made and you confirm it — never before.
4. Only calls `delete` when you explicitly ask to cancel a task.

### Prioritization

When you ask "what's next?", Claude recommends in this order:

1. `bug` — defects first
2. `tool` — developer tooling compounds
3. `feature` — planned work
4. `idea` — exploratory, needs refinement
5. `other` — case-by-case

Within each type: highest priority first, newest id first.

### Workflow pipeline

1. **Schedule** — out-of-scope requests go to `add`, not inline implementation. New tasks default to `refinement`.
2. **Refine** — for refinement tasks: Claude asks PM questions, enriches the description, promotes to `todo`
3. **Plan** — for features: write a plan document before touching any code
4. **Implement** — reads relevant files first; no speculative changes
5. **Build** — must succeed with zero errors
6. **Test** — verifies end-to-end; waits for your confirmation
7. **Commit** — stages files, writes a clear commit message
8. **Next** — suggests what to do next

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

`TASKS.md` has a `# Counter: N` header tracking the highest id ever issued. Prefer using the MCP tools over editing these files by hand.

**Types**: `bug` · `feature` · `idea` · `tool` · `other`  
**Priorities**: `low` · `medium` · `high` · `critical`  
**Statuses**: `refinement` · `todo` · `in_progress` · `done`

---

## Tools

These are called by Claude — you don't type them yourself.

| Tool | What it does |
|---|---|
| `add` | Schedule a new task. Required: `type`, `priority`, `title`, `description`. Optional: `scope`, `refs`, `status` (`refinement` default; pass `todo` to skip refinement). Returns the new `id`. Refs are auto-mirrored on the other side. |
| `update` | Edit any field of an existing task in place. Pass `null` to clear `scope` or `refs`. Works on active and done tasks. |
| `setStatus` | Move a task: `refinement` → `todo` → `in_progress` → `done`. `done` automatically archives it to `TASKS_DONE.md`. Setting a non-done status on a done (archived) task restores it to `TASKS.md`. |
| `getNext` | The single recommended next task — answers "what's next?". Returns `refinement` tasks after `in_progress`, before `todo`. |
| `getAll` | All not-done tasks (refinement + todo + in_progress) grouped by type. |
| `getByType` | All tasks of one type across all statuses, including done. |
| `getByScope` | All tasks tagged with a specific scope (exact, case-sensitive). Empty results may indicate a typo'd scope — use `getScopes` to discover valid values. |
| `getByStatus` | All tasks with a specific status. `done` reads from `TASKS_DONE.md`; all other statuses read from `TASKS.md`. Optional `scope` filter. Returns `{ tasks: [] }` on empty, not an error. |
| `getScopes` | List all scopes across active and done tasks with `total` and `open` counts. Use to discover valid scope values. |
| `getById` | One task by its number — searches both active and done. |
| `getRelated` | Tasks that reference a given id (`inbound`, decorated with `refRelation`) and tasks it references (`outbound`, decorated with `refRelation`). |
| `getOverview` | Count summary per type: `refinement`, `open` (todo + in_progress), and `done` counts. |
| `delete` | Permanently remove a task. Only use when asked — prefer `setStatus(done)` for finished work. |

### Refs — structured relations with automatic mirroring

Pass `refs: [{ id, relation }]` to `add` or `update` to link tasks. When you add a ref on task A pointing to task B, the server **automatically writes the inverse on task B** — you never need to add both sides manually.

| You set on A → B | Server writes on B → A |
|---|---|
| `blocks` | `is blocked by` |
| `is blocked by` | `blocks` |
| `depends on` | `is depended on by` |
| `is depended on by` | `depends on` |
| `causes` | `is caused by` |
| `is caused by` | `causes` |
| `tests` | `is tested by` |
| `is tested by` | `tests` |
| `relates to` | `relates to` (symmetric) |

Default relation: `"relates to"`. Removing a ref also removes the inverse. Deleting a task cascades and strips all inbound refs.

**Hand-edited refs**: if you type a relation in TASKS.md that isn't in the table above, the parser keeps it verbatim and does not mirror it. It stays as-is until you edit it via the UI or MCP.

To normalize legacy notes and backfill missing inverses, run the migration script once:

```sh
node migrate-refs.js
```

Use `getRelated(id)` to query connections.

### Scope — tagging tasks to an area

Set `scope` on tasks belonging to a specific tool or area (e.g. `"auth"`, `"api"`). Omit for project-wide tasks. Query with `getByScope("auth")` (exact, case-sensitive) or `getByStatus` with a `scope` filter. Use `getScopes` to list all valid scope values and their open/total counts.

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

The `prepare` script installs a pre-commit hook that:
1. Bumps the server version in `version.js` using CalVer (`YYYY-MM-NNN`, resetting `NNN` to `001` on the first commit of a new month), then `git add`s the file so the bump is included in the commit.
2. Runs `npm test`.

The version is exposed to MCP clients under `serverInfo.version` in the `initialize` handshake.

# simple-task-manager MCP

A persistent task manager for [Claude Code](https://claude.ai/code), exposed as an [MCP](https://modelcontextprotocol.io) server. Tasks live in a single SQLite database (`tasks.db`) at the project root. Claude uses them to track work across sessions, survive context compaction, and suggest what to do next.

**No separate Claude instructions needed** — behavioral rules are embedded in the server and loaded automatically when Claude connects.

**Web UI included.** When Claude starts the MCP, it also spawns a bundled web app (`simple-task-manager/task-manager-ui/`) at <http://localhost:7374>. It's a live browser view of the same SQLite database — edits in either direction sync within ~1s. Optional; the MCP starts fine without it.

---

## Prerequisites

- **Node.js 18 or later** — check with `node --version`. Download from [nodejs.org](https://nodejs.org) if not installed.
- **Claude Code** — the CLI or desktop app.

---

## Quick Start

### Step 1 — Clone and install

```sh
git clone https://github.com/dabalroman/mcp-servers ~/.claude/mcp-servers
cd ~/.claude/mcp-servers/simple-task-manager && npm install
```

That single install does everything:
- Installs MCP dependencies and builds `dist/server.js`.
- Descends into `task-manager-ui/` (the bundled sub-package) and runs `npm install` there too, which builds the UI bundle. The MCP will auto-spawn the UI on startup.
- Installs the pre-commit hook that keeps both `dist/`s in sync with source.
- Registers an `@-include` in `~/.claude/CLAUDE.md` so Claude knows how to set up the MCP in any project. Idempotent — safe to re-run.

To skip the UI entirely, delete or rename `task-manager-ui/` before running `npm install` — the bundled installer no-ops when the directory is missing, and the MCP detects the absence and starts without it. You can also disable it at runtime with `TASK_UI_DISABLE=1`.

**Upgrading from a pre-TypeScript install?** Re-run the installer in each project (see Step 2) — Claude will refresh the stale `args` path in `.mcp.json` from `server.js` to `dist/server.js`.

### Step 2 — Register in a project

Open Claude Code in any project and say:

> "Set up the task manager for me"

Claude will run the installer, write `.mcp.json` with the correct paths, and tell you to restart. **Commit `.mcp.json` to git** so teammates get the same setup automatically.

### Step 3 — Approve and go

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
8. **Curate** — after `setStatus(done)`: update the closest CLAUDE.md with non-obvious decisions, gotchas, new conventions, and architecture changes; prune any entries now stale. Skip if nothing worth capturing.
9. **Next** — suggests what to do next

---

## Web UI

When the MCP starts, it tries to spawn `./task-manager-ui/server.ts` (bundled sub-package) as a child process. The UI is a small Express app that:

- Serves a React SPA at <http://localhost:7374> showing the same tasks the MCP sees.
- Pushes live updates (SSE) when the MCP writes — no manual refresh.
- Lets you add, edit, re-prioritize, set status, link refs, and delete tasks from the browser. Edits flow back through the same SQLite file.

The UI dies with the MCP (SIGTERM on shutdown). One MCP per project = one UI per project.

### Env vars

| Variable | Default | Effect |
|---|---|---|
| `TASKS_DB` | required | Path to the SQLite database. Forwarded to the UI so both processes open the same file. |
| `TASK_UI_PORT` | `7374` | HTTP port for the UI. Change if 7374 is taken. |
| `AUTO_OPEN_TASK_UI` | unset | When `1`, the UI opens its URL in the system browser on startup. Off by default — the URL is always printed to stderr. |
| `TASK_UI_DISABLE` | unset | When `1`, the MCP skips spawning the UI entirely. Useful in tests or when you want to run the UI manually from a separate terminal. |

### Run the UI manually

```sh
cd ~/.claude/mcp-servers/simple-task-manager/task-manager-ui
TASKS_DB=/abs/path/to/project/tasks.db npm start
```

Useful for testing or for hosting the UI on a server (set `TASK_UI_PORT`, expose the port).

### Behaviour when the UI is missing

If `~/.claude/mcp-servers/simple-task-manager/task-manager-ui/server.ts` doesn't exist (e.g. you removed the sub-package), the MCP writes:

```
[simple-task-manager] task-manager-ui not found at … — UI will not be available
```

…and continues normally. JSON-RPC tools still work as before.

---

## Storage — SQLite

Tasks live in a single SQLite database (default `tasks.db` at the project root). Schema:

| Table | Purpose |
|---|---|
| `meta` | Key/value (currently just `counter` — last issued id) |
| `tasks` | One row per task: `id, title, type, status, priority, scope, summary, description, plan, created_at, updated_at` |
| `refs` | `(from_id, to_id, relation, non_canonical)` — directed; mirrors are written for canonical refs |
| `schema_migrations` | Audit trail of applied schema migrations alongside `PRAGMA user_version` |

Journal mode is `DELETE` (the SQLite default). WAL was tried first but its mmap'd `tasks.db-shm` region doesn't stay coherent when the writer and reader live in different VFS namespaces (e.g. host MCP + containerised reader sharing the file via a Docker bind mount) — readers kept stale snapshots until checkpoint. DELETE coordinates via POSIX advisory locks on the main DB file, which is bind-mount-safe. Write contention is a non-issue at this scale (tens of writes per session). The DB file (`tasks.db` in each project using the MCP) should be committed to git — tasks are project knowledge and teammates pulling the repo see the same backlog. Only the transient `tasks.db-journal` is gitignored.

### Migrating from the legacy markdown format

```sh
npx tsx ~/.claude/mcp-servers/simple-task-manager/migrate.ts \
  /path/to/TASKS.md /path/to/TASKS_DONE.md /path/to/tasks.db
```

Behaviour:
- Refuses to run if `tasks.db` already exists — rename or remove it first.
- Writes `.bak` copies next to both legacy files before reading.
- Parses the legacy `# id title` / `## type | status | priority` / `$scope:` / `$ref:` format using a parser bundled inside `migrate.ts` (the main `tasks.ts` no longer carries legacy code).

**Types**: `bug` · `feature` · `idea` · `tool` · `other`  
**Priorities**: `low` · `medium` · `high` · `critical`  
**Statuses**: `refinement` · `todo` · `in_progress` · `done`

---

## Tools

These are called by Claude — you don't type them yourself.

| Tool | What it does |
|---|---|
| `add` | Schedule a new task. Required: `type`, `priority`, `title`, `description`. Optional: `scope`, `plan`, `refs`, `status` (`refinement` default; pass `todo` to skip refinement). Returns the new `id`. Refs are auto-mirrored on the other side. |
| `update` | Edit any field of an existing task in place. Pass `null` to clear `scope`, `plan`, or `refs`. Works on active and done tasks. |
| `setStatus` | Move a task: `refinement` → `todo` → `in_progress` → `done`. All statuses live in the same `tasks` table — moving to `done` is just an UPDATE. |
| `getNext` | The single recommended next task — answers "what's next?". Returns `refinement` tasks after `in_progress`, before `todo`. |
| `getAll` | All not-done tasks (refinement + todo + in_progress) grouped by type. |
| `getByType` | All tasks of one type across all statuses, including done. |
| `getByScope` | All tasks tagged with a specific scope (exact, case-sensitive). Empty results may indicate a typo'd scope — use `getScopes` to discover valid values. |
| `getByStatus` | All tasks with a specific status. Optional `scope` filter. Returns `{ tasks: [] }` on empty, not an error. |
| `getScopes` | List all scopes across active and done tasks with `total` and `open` counts. Use to discover valid scope values. |
| `getById` | One task by its number. |
| `getRelated` | Tasks that reference a given id (`inbound`, decorated with `refRelation`) and tasks it references (`outbound`, decorated with `refRelation`). |
| `getOverview` | Count summary per type: `refinement`, `open` (todo + in_progress), and `done` counts. |
| `delete` | Permanently remove a task. Cascades to all rows in `refs` (FK ON DELETE CASCADE). Only use when asked — prefer `setStatus(done)` for finished work. |

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

**Non-canonical refs**: rows in the `refs` table can carry `non_canonical = 1` — those are kept verbatim and never auto-mirrored (they originate from hand-edited markdown that was migrated in). Re-saving such a ref via the MCP `update` tool with a canonical relation normalizes it.

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
Check that the `TASKS_DB` path in `.mcp.json` is absolute and points to a real location (not a placeholder).

**The server fails to start**  
Run `node dist/server.js` directly from the `simple-task-manager` directory and read the error. If `dist/` doesn't exist, run `npm install` (or `npm run build`) first — `dist/` is generated, not committed. The most common cause is a missing or wrong `TASKS_DB` environment variable. If you still have legacy `TASKS_FILE` / `TASKS_DONE_FILE` set, the server emits a one-time warning suggesting the rename and refuses to start without `TASKS_DB`.

**The web UI doesn't open at <http://localhost:7374>**  
Reconnect the MCP (`/mcp` in Claude Code) and watch the MCP's stderr for one of:

- `task-manager-ui not found at … — UI will not be available` — the sub-package is missing or wasn't built. Run `cd ~/.claude/mcp-servers/simple-task-manager && npm install` to rebuild, then reconnect the MCP.
- `task-manager-ui spawn disabled via TASK_UI_DISABLE=1` — unset the env var.
- `failed to spawn task-manager-ui: …` — usually means `node_modules/tsx` is missing in `task-manager-ui/`. Run `npm install` there.
- Port already in use (the listening line never prints) — set `TASK_UI_PORT` to a free port in the MCP's `.mcp.json` env block.

**The UI shows tasks but the MCP doesn't see new ones (or vice versa)**  
Both processes must point at the same `TASKS_DB`. The MCP forwards its own `TASKS_DB` to the UI when spawning, so this should be automatic — but if you start the UI manually, double-check the path matches the one in `.mcp.json`.

---

## Development

The package is **TypeScript** (strict mode). Source files live at the package root; the production build is compiled to `dist/`.

```sh
npm install      # builds dist/ via prepare; installs the pre-commit hook
npm run build    # tsc → dist/
npm run typecheck
npm test         # node --import tsx --test on *.test.ts (no precompile)
npm run verify   # typecheck + test + build
npm start        # node dist/server.js — Claude Code does this automatically via .mcp.json
```

### File layout

- `server.ts` — bootstrap only (env validation, `createStore`, `new McpServer`, `registerTools`, shutdown handlers, transport).
- `instructions.ts` — the `INSTRUCTIONS` string surfaced to MCP clients on connect.
- `tasks.ts` — SQLite storage layer (schema, migrations, queries) and all exported types (`Task`, `Ref`, `Store`, `TaskType`, `TaskStatus`, `TaskPriority`, `AddInput`, `UpdatePatch`). Always returns complete task objects.
- `mcp/shared.ts` — `text` / `errorText`, `toListTask` (description-stripping for list responses), `allIdsSorted`, `notFoundError`, `MCPContent` type, zod `refsSchema`.
- `mcp/queryHandlers.ts` — pure `(store, args)` handlers for the 9 read tools.
- `mcp/mutationHandlers.ts` — pure handlers for `add`, `update`, `setStatus`, `delete`.
- `mcp/registerTools.ts` — `registerTools(server, store)` declares each tool's name, description, and zod input schema, then wires it to its handler.

Adding a new tool: write the handler in `mcp/{query,mutation}Handlers.ts`, declare it in `mcp/registerTools.ts`, and test it in `server.test.ts` by importing the handler directly.

The `prepare` script (auto-run on `npm install`) installs a pre-commit hook that:
1. Bumps the server version in `version.ts` using CalVer (`YYYY-MM-NNN`, resetting `NNN` to `001` on the first commit of a new month), then `git add`s the file so the bump is included in the commit.
2. Runs `npm test` and `npm run build` for this package.
3. If the sibling `task-manager-ui/` exists, runs `npm test` and `npm run build` there too so both `dist/`s stay in sync with the committed source.

The version is exposed to MCP clients under `serverInfo.version` in the `initialize` handshake.

### Sub-package — `task-manager-ui/`

The web UI is a self-contained npm sub-package at `simple-task-manager/task-manager-ui/`. It imports `tasks.ts` directly from the parent (`../tasks.js`) — **no vendor mirror, no `EXPECTED_MIGRATIONS` array** to keep in sync. Schema changes touch only the MCP package; the UI picks them up at the next tsx import.

See `task-manager-ui/CLAUDE.md` for its file layout and conventions.

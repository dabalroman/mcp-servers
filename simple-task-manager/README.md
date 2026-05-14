# simple-task-manager MCP

A persistent task manager for [Claude Code](https://claude.ai/code), exposed as an [MCP](https://modelcontextprotocol.io) server. Tasks live in a single SQLite database (`tasks.db`) at the project root. Claude uses them to track work across sessions, survive context compaction, and suggest what to do next.

**No separate Claude instructions needed** — behavioral rules are embedded in the server and loaded automatically when Claude connects.

**Web UI included.** When Claude starts the MCP, it also spawns a bundled web app (`simple-task-manager/task-manager-ui/`) at <http://localhost:7374>.

&nbsp;
&nbsp;
&nbsp;

## Prerequisites

- **Node.js 18 or later** — check with `node --version`. Download from [nodejs.org](https://nodejs.org) if not installed.
- **Claude Code** — the CLI or desktop app.


&nbsp;
&nbsp;
&nbsp;

## Quick Start

### Step 1 — Clone and install

```sh
git clone https://github.com/dabalroman/mcp-servers ~/.claude/mcp-servers
cd ~/.claude/mcp-servers/simple-task-manager && npm install
```


### Step 2 — Register in a project

Open Claude Code in any project and say:

```
Set up the task manager for me.
```

Claude will run the installer, write `.mcp.json` with the correct paths, and tell you to restart.


### Step 3 — Approve and go

Restart Claude Code. On first launch it will prompt:

```
Allow MCP server "task-manager" to run?
```

Then ask if everyting is nice and tasty:
```
Use mcp health tool to check if everything is set up.
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


&nbsp;
&nbsp;
&nbsp;

## Skills included 

### /refine
Use this skill to refine any task. Claude will act as a PM and ask great questions about your task, and then update the description with refined version.
- `"/refine #143"`
- `"Let's /refine mcp tasks"`

### /implement
Use this skill to implement tasks. Claude will use all knowledge from simple-task-manager and it's ability to judge on the scope to run implementation inline, async or via available agents. 
It will try to write and run tests to ensure code quality.
- `"/implement #143"`
- `"Go on, fix that data-fetching bug"`

&nbsp;
&nbsp;
&nbsp;

## How Claude behaves

### Scheduling discipline

Claude distinguishes between *scheduling* and *implementing*. If you say "TODO X", "schedule X", "add X to the list", "BUG X", or "FEATURE X" — Claude will call `add` and stop. It will not also implement the thing. If you mention a bug or feature while working on something else, Claude will ask whether to schedule it before continuing.

At the end of a task or session, Claude will suggest what to do next via `getNext`.

### User prefixes

You can prefix any message to signal intent:

| Prefix | Task type | Default behaviour |
|---|---|---|
| `BUG` | `bug` | Scheduled at high priority; surfaced before features |
| `FEATURE` | `feature` | Scheduled; requires a planning session before implementation starts |
| `IDEA` | `idea` | Scheduled as exploratory; needs refinement before becoming a feature |

### Task lifecycle

1. New tasks **always** default to `refinement` — even when the task feels small or obvious. Claude acts as project manager: asks you clarifying questions, enriches the description, then promotes to `todo` when ready. Claude is allowed to skip refinement (pass `status: 'todo'` to `add`) **only** when (a) you explicitly ask for it ("schedule as todo", "no refinement needed"), or (b) refinement just happened in the current conversation.
2. Status changes to `in_progress` **before** starting any work.
3. Status changes to `done` **after** the commit is made and you confirm it — never before.

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


&nbsp;
&nbsp;
&nbsp;

## Web UI

When the MCP starts, it tries to spawn `./task-manager-ui/server.ts` (bundled sub-package) as a child process. The UI is a small Express app that:

- Serves a React SPA at <http://localhost:7374> showing the same tasks the MCP sees.
- Pushes live updates (SSE) when the MCP writes — no manual refresh.
- Lets you add, edit, re-prioritize, set status, link refs, and delete tasks from the browser. Edits flow back through the same SQLite file.

The UI dies with the MCP (SIGTERM on shutdown). One MCP per project = one UI per project.

### Env vars

All four are written to `.mcp.json` by `install.ts` with the defaults below — no hidden behaviour.

| Variable | Default | Effect |
|---|---|---|
| `TASKS_DB` | `<project>/tasks.db` | Path to the SQLite database. Forwarded to the UI so both processes open the same file. |
| `TASK_UI_PORT` | `7374` | HTTP port for the UI. |
| `AUTO_OPEN_TASK_UI` | `0` | Set to `1` to open the UI in the system browser on startup. |
| `TASK_UI_DISABLE` | `0` | Set to `1` to skip spawning the UI entirely. |


&nbsp;
&nbsp;
&nbsp;

## Tools

These are called by Claude — you don't type them yourself.

**Writing**

| Tool | What it does |
|---|---|
| `add` | Schedule a new task. |
| `update` | Edit any field in place. |
| `setStatus` | Move a task through `refinement` → `todo` → `in_progress` → `done`. |
| `delete` | Permanently remove a task. |

**Reading**

| Tool | What it does |
|---|---|
| `getNext` | The single recommended next task. |
| `getAll` | All not-done tasks, grouped by type. |
| `getById` | One task by number. |
| `getByType` | All tasks of one type. |
| `getByScope` | All tasks tagged with a scope. |
| `getByStatus` | All tasks with a given status. |
| `getScopes` | All scope tags with counts. |
| `getRelated` | Tasks linked to a given id. |
| `getOverview` | Per-type counts (refinement / open / done). |

**Diagnostics & UI control**

| Tool | What it does |
|---|---|
| `health` | Sanity-check the setup; also reports the UI URL. |
| `ui-start` | Start the UI server (idempotent). |
| `ui-stop` | Stop the UI server. |

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


&nbsp;
&nbsp;
&nbsp;

## Troubleshooting

**Claude doesn't see the MCP tools**  
Make sure you approved the server when prompted. Restart the Claude Code session — the approval prompt reappears if the server isn't approved yet.

**Tasks aren't persisting between sessions**  
Check that the `TASKS_DB` path in `.mcp.json` is absolute and points to a real location (not a placeholder).

**The web UI doesn't open at <http://localhost:7374>**  
Reconnect the MCP (`/mcp` in Claude Code) and watch the MCP's stderr for one of:

- `task-manager-ui not found at … — UI will not be available` — the sub-package is missing or wasn't built. Run `cd ~/.claude/mcp-servers/simple-task-manager && npm install` to rebuild, then reconnect the MCP.
- `task-manager-ui spawn disabled via TASK_UI_DISABLE=1` — unset the env var.
- `failed to spawn task-manager-ui: …` — usually means `node_modules/tsx` is missing in `task-manager-ui/`. Run `npm install` there.
- Port already in use (the listening line never prints) — set `TASK_UI_PORT` to a free port in the MCP's `.mcp.json` env block.


&nbsp;
&nbsp;
&nbsp;

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

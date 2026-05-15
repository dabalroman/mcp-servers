# simple-task-manager MCP

A persistent task manager for [Claude Code](https://claude.ai/code), exposed as an [MCP](https://modelcontextprotocol.io) server. Tasks live in a single SQLite database (`tasks.db`) at your's project root. Claude uses it to track work across sessions, survive context compaction, and suggest what to do next. It uses refine - plan - implement workflow to ensure best possible results. 

**Batteries included** - behavioral rules are embedded in the server and loaded automatically when Claude connects.

**Skills included** - Use `/refine` and `/implement` skills to make it flow!

**Web UI included** - When Claude starts the MCP, it also spawns a bundled web app at <http://localhost:7374>.

&nbsp;
&nbsp;
&nbsp;

## Prerequisites

- **Node.js 18 or later** — check with `node --version`.
- **Claude Code** — the CLI.

> [!warning]
> This was tested on multiple Linux and WSL2 setups with Claude Code CLI.
> Good luck if you're working on PowerShell! 


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

Approve it. Then ask if everyting is nice and tasty:
```
Use mcp health tool to check if everything is set up.
```

Then try some prompts:

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

All of these are written to `.mcp.json` by `install.ts` with the defaults below — no hidden behaviour. `install.ts` also prints each var's purpose to the console after writing the file (Claude Code's MCP loader is strict JSON, so we can't put doc comments inline). The table below is the canonical reference.

| Variable | Default | Effect |
|---|---|---|
| `TASKS_DB` | `<project>/tasks.db` | Path to the SQLite database. Forwarded to the UI so both processes open the same file. |
| `PROJECT_NAME` | project dir name | Human-readable project label. Renders as the big pill in the UI header and as the browser tab title (`<name> · tasks`). Also used as the pm2 process name in `standalone` mode. |
| `TASK_UI_PORT` | `7374` | HTTP port the UI binds to. |
| `TASK_UI_MODE` | `bundled` | How the UI runs. One of `bundled`, `standalone`, `disabled` — see below. |
| `TASK_UI_AUTO_OPEN_IN_BROWSER` | `0` | Set to `1` to open the UI in the system browser on startup. |

#### `TASK_UI_MODE` — the single switch for UI lifecycle

| Value | Meaning |
|---|---|
| `bundled` (default) | The MCP spawns the UI as a child process. UI dies with the Claude session. Best for casual / single-session use. |
| `standalone` | The UI runs as a long-lived [pm2](https://pm2.keymetrics.io/) process. Survives MCP restarts and Claude session closes. Set up via `setup-standalone.ts on` (below) — don't edit this value by hand. |
| `disabled` | The MCP doesn't start the UI at all. Useful for headless / CI / tests, or when you want to run the UI manually from a separate terminal. |

In `standalone` and `disabled` modes the `ui-start` / `ui-stop` MCP tools return a clear error explaining what to do instead — they never silently no-op.

### Standalone UI mode

By default the UI is a child of the MCP — it dies whenever Claude restarts the MCP or you close the session. If you want the UI to persist across sessions (handy when you keep a project open for a long time), opt that project in:

```sh
# from the project directory (where .mcp.json lives)
npx tsx ~/.claude/mcp-servers/simple-task-manager/setup-standalone.ts on
```

The script will:

1. Set `TASK_UI_MODE=standalone` in `.mcp.json` and ensure `PROJECT_NAME` + `TASK_UI_PORT` are populated (defaults: project dir name, `7374`).
2. Generate `<project>/ecosystem.task-ui.config.cjs` (a pm2 config file). The filename must include `.config.` — that's how pm2 recognises it as a config file rather than a script.
3. Run `pm2 start ./ecosystem.task-ui.config.cjs && pm2 save` so the UI process restarts on boot (assuming `pm2 startup` is configured).

Restart Claude Code afterwards. The MCP sees `TASK_UI_MODE=standalone` and skips spawning its own UI child; the `ui-start` / `ui-stop` MCP tools point you at `pm2 restart <PROJECT_NAME>` instead.

To turn it off:

```sh
npx tsx ~/.claude/mcp-servers/simple-task-manager/setup-standalone.ts off
```

That deletes the pm2 process, removes the ecosystem file, sets `TASK_UI_MODE=bundled`, and (after a Claude restart) the MCP resumes spawning the UI.

Two projects can each have their own standalone UI in parallel — give them distinct `PROJECT_NAME` and distinct `TASK_UI_PORT` values in their respective `.mcp.json` files.


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

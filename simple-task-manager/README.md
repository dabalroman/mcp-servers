# simple-task-manager MCP

A persistent task manager for [Claude Code](https://claude.ai/code), exposed as an [MCP](https://modelcontextprotocol.io) server. Tasks live in a single SQLite database (`tasks.db`) at your's project root. Claude uses it to track work across sessions, survive context compaction, and suggest what to do next. It uses refine - plan - implement workflow to ensure best possible results. 

**Batteries included** - core behavioral rules are embedded in the server and loaded automatically when Claude connects; the full rule set ships with the `task-manager` Claude Code plugin.

**Skills included** - The plugin adds `/refine`, `/implement`, `/implement-as-coordinator` and `/assess` to make it flow! If another command already uses one of these names, the namespaced form always works (e.g. `/task-manager:implement`).

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

### Step 1 — Install the plugin (once per machine)

```
/plugin marketplace add dabalroman/mcp-servers
/plugin install task-manager@dabalroman
```

This gives you the skills and the full usage rules, which a SessionStart hook injects only in repos
whose `.mcp.json` has a `task-manager` entry. No clone or build is needed for it.

Auto-update is off by default for third-party marketplaces. Turn it on under `/plugin` →
Marketplaces → Enable auto-update, or update by hand with
`claude plugin marketplace update dabalroman` followed by `/reload-plugins`.

The plugin follows GitHub `main`. If the server runs on a separate host, pull there after every
push, or the skills may call tools the host doesn't have yet. On the host itself you can add the
marketplace from the local clone instead (`/plugin marketplace add <dir>`); it loads in place.

**Upgrading an existing clone?** Follow [UPGRADING.md](UPGRADING.md): the steps for every pull, version notes (plugin, projects), rollback and FAQ.

### Step 2 — Bind a repo

Each repo gets its own `task-manager` entry in `.mcp.json`, which also carries its project binding.

**stdio** (the repo lives on the machine that runs the server): clone the package once, anywhere,
then run the installer from each repo.

```sh
git clone https://github.com/dabalroman/mcp-servers <dir>   # any location works
cd <dir>/simple-task-manager && npm install
cd <your repo> && npx tsx <dir>/simple-task-manager/install.ts
```

The installer builds `dist/` and writes `.mcp.json` with the correct paths.

**client mode** (repos connect over HTTP to one long-running server, on this machine or another):
see [Client mode: connect to the server over HTTP](#client-mode-connect-to-the-server-over-http).


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
Use this skill to refine any task. Claude acts as a PM. It first looks at the task as a product decision: who it serves, what the user gets, how you would know it worked, and which related ideas are worth filing separately. Then it asks the technical questions and rewrites the description in Goal / Facts / Changes / Steps form. If a task is split into several, it offers to put them under a new epic (or the original's existing epic), so the shared goal and order stay in one place.
- `"/refine #143"`
- `"Let's /refine mcp tasks"`

### /implement
Use this skill to implement tasks. Claude will use all knowledge from simple-task-manager and it's ability to judge on the scope to run implementation inline, async or via available agents. 
It will try to write and run tests to ensure code quality.
A task split into phases can be committed phase by phase: Claude asks once; phases that need you (a manual test, a merge) are parked while the rest continues, and you get every such request at once. On an epic, it hands over to `/implement-as-coordinator`.
- `"/implement #143"`
- `"Go on, fix that data-fetching bug"`

### /implement-as-coordinator
Use this skill to hand a whole queue to Claude as a supervisor you can walk away from. Claude orders the tasks by file overlap and dependency, runs one subagent per task through `/implement` (Sonnet for well-scoped work, Opus for new architecture or hazardous rewrites, picked per task; disjoint tasks in parallel), independently re-checks every hand-back, owns every build and deploy (build all targets), then code-reviews the whole change and fixes what it finds, all uncommitted. Questions are held until the final report, which asks for approval. Tasks that need you (a manual test, a merge) are parked while all other work continues, and you get every such request at once when nothing else can move; only then does it commit, one commit per feature on the current branch. Run it on an epic (`/implement #NN` on an epic hands over to it) and it works through the epic's children in the epic's order. It asks once whether to commit each child as it lands, and lists children that still need `/refine`.
- `"/implement-as-coordinator #45 #50 #43"` — those tasks, in the order Claude decides
- `"/implement-as-coordinator <scope>"` or no argument — every `todo` task in the scope / overall

### /assess
Use this skill to step back and judge a scope as a product. Claude first saves and reviews real-usage evidence, recording each trial against fixed checks, and you give the go/no-go verdict. Then an advocate and a skeptic agent argue about the product over two rounds. Claude synthesises their arguments into ranked suggestions, and only the ones you pick become tasks.
- `"/assess #283"` — run the evaluation task #283
- `"/assess vault ai"` — assess a scope

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

1. New tasks **always** default to `refinement` — even when the task feels small or obvious. Claude acts as project manager: asks you clarifying questions, enriches the description, then promotes to `todo` (or `plan`) when ready. Claude is allowed to skip refinement (pass `status: 'todo'` to `add`) **only** when (a) you explicitly ask for it ("schedule as todo", "no refinement needed"), or (b) refinement just happened in the current conversation.
2. (Opt-in) `plan` sits between `refinement` and `todo`. Use it when a task needs a written implementation plan before coding starts. Lifecycle: `refinement` → **`plan`** → `todo` → `in_progress` → `done`. Skip `plan` for straightforward tasks.
3. Status changes to `in_progress` **before** starting any work.
4. Status changes to `done` **after** the commit is made and you confirm it — never before.

### Prioritization

When you ask "what's next?", Claude recommends in this order:

1. `bug` — defects first
2. `tool` — developer tooling compounds
3. `feature` — planned work
4. `idea` — exploratory, needs refinement
5. `other` — case-by-case

`epic` tasks are never recommended — see [Epics](#epics--shared-context-for-a-group-of-tasks).

Within each type: highest priority first, newest id first.

### Workflow pipeline

1. **Schedule** — out-of-scope requests go to `add`, not inline implementation. New tasks default to `refinement`.
2. **Refine** — for refinement tasks: Claude asks PM questions, enriches the description, promotes to `plan` or `todo`
3. **Plan** — opt-in: for features needing a written plan, task enters `plan` status; Claude writes the plan, then promotes to `todo`
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
- Shows one project at a time. With more than one project, a tab strip above the list switches between them (with open counts) and the browser remembers your pick. `+ Project` creates one; the task form's project select moves a task. Clicking a ref into another project switches to it. The URL carries the project (`http://<host>:7374/<project>`), so a link or bookmark opens that project and Back/Forward switch between projects.

The UI dies with the MCP (SIGTERM on shutdown). One MCP per project = one UI per project.

### Update checks

Both the `health` MCP tool and the web UI check once an hour whether a newer version is published on the `main` branch of this repo (cached in-memory, never blocks startup). The `health` report gets a `Version` line; the UI header shows a badge with upgrade steps when one is available. A failed or unreachable check is reported as "unavailable", never as an error.

### Env vars

All of these are written to `.mcp.json` by `install.ts` with the defaults below — no hidden behaviour. `install.ts` also prints each var's purpose to the console after writing the file (Claude Code's MCP loader is strict JSON, so we can't put doc comments inline). The table below is the canonical reference.

| Variable | Default | Effect |
|---|---|---|
| `TASKS_DB` | `<project>/tasks.db` | Path to the SQLite database. Forwarded to the UI so both processes open the same file. |
| `PROJECT_NAME` | project dir name | The [project](#projects--one-database-many-repos) this repo's sessions work in; unset means `default`. |
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
npx tsx <dir>/simple-task-manager/setup-standalone.ts on
```

The script will:

1. Set `TASK_UI_MODE=standalone` in `.mcp.json` and ensure `PROJECT_NAME` + `TASK_UI_PORT` are populated (defaults: project dir name, `7374`).
2. If another repo already runs a task-manager UI on that port, join it and stop here (see [Sharing one UI](#sharing-one-ui-across-repos)).
3. Otherwise generate `<project>/ecosystem.task-ui.config.cjs` (a pm2 config file). The filename must include `.config.` — that's how pm2 recognises it as a config file rather than a script.
4. Run `pm2 start ./ecosystem.task-ui.config.cjs && pm2 save` so the UI process restarts on boot (assuming `pm2 startup` is configured). The pm2 app is called `task-manager` (`task-manager-<port>` on a port other than `7374`).

Restart Claude Code afterwards. The MCP sees `TASK_UI_MODE=standalone` and skips spawning its own UI child; the `ui-start` / `ui-stop` MCP tools point you at `pm2 restart task-manager` instead.

**Changing the env.** `pm2 restart task-manager` keeps the env the app was first started with, so an edited ecosystem file is silently ignored. After any env change run `pm2 restart ./ecosystem.task-ui.config.cjs --update-env` (or `pm2 delete task-manager` and `pm2 start ./ecosystem.task-ui.config.cjs`). Re-running `setup-standalone.ts on` does this for you.

To turn it off:

```sh
npx tsx <dir>/simple-task-manager/setup-standalone.ts off
```

That sets `TASK_UI_MODE=bundled`. In the repo that owns the UI (the one holding the ecosystem file) it also deletes the pm2 app and the file; in a repo that joined, the shared UI keeps running.

#### Sharing one UI across repos

One UI serves every project in its database, and its project tabs show which one you're on. So repos that share a `TASKS_DB` share one standalone UI too: give them the same `TASK_UI_PORT` and run `setup-standalone.ts on` in each. The first repo owns the UI; the others find it on the port and only update their own `.mcp.json`.

Repos with separate databases need separate UIs: give them distinct `TASK_UI_PORT` values, and each gets its own pm2 app (`task-manager-<port>`).

### Client mode: connect to the server over HTTP

The out-of-the-box setup is bundled: one repo, a stdio MCP, its own UI and DB, and no key. To share
one database across repos and machines instead, run one long-running **server** (the pm2 process that
serves the UI and the MCP at `/mcp`) and connect each repo to it in **client mode**. The same steps
apply to every machine, including the one running the server.

**On the server machine, once:**

1. Install as in [Step 2](#step-2--bind-a-repo) in one repo, then run
   `npx tsx <dir>/simple-task-manager/setup-standalone.ts on` there. That starts the pm2 app
   `task-manager` on port 7374, which keeps running across sessions and reboots.
2. To reach it from other machines, put an HTTPS reverse proxy in front of it (for example
   `tailscale serve`). The app itself speaks plain HTTP. **Expose `/mcp` only**: the UI and its
   `/api` have no login, and anyone who can open the UI can create keys.

**For each repo you want connected (on any machine, the server machine included):**

1. Open the UI and click **Connect a machine** in the footer. Enter a label (e.g.
   `laptop / my-repo`), the repo's default project and the server URL as that machine will reach it
   (the HTTPS proxy URL for a remote machine; the default is the address you opened the UI at).
   Click **Create key**.
2. The dialog shows the key **once**, inside one line to run in the repo:

   ```sh
   claude mcp add --transport http task-manager '<url>' --header 'Authorization: Bearer <key>' --scope local
   ```

   Local scope stores the entry in your user config (`~/.claude.json`), not in the repo's
   `.mcp.json`, so the key is never committed. If the repo already has a `task-manager` entry, run
   `claude mcp remove task-manager -s local` first. Or click **Copy setup prompt for agent** and
   paste it into Claude Code in that repo; it contains the key, so treat it like one.
3. Restart Claude Code in the repo and run the `health` tool. It should report `Transport = http`
   and the default project you picked.

**Managing keys.** The same dialog lists the active keys with their default project, creation time
and last use. **Revoke** cuts that repo off on its next request. Only a SHA-256 of each key is
stored; a lost key can't be shown again, so create a new one and revoke the old.

**How it behaves:**

- Every `/mcp` request needs `Authorization: Bearer <key>`, from the same machine too: a reverse
  proxy forwards from `127.0.0.1`, so a loopback exemption would let every proxied request
  through. A missing, wrong or revoked key gets `401 Unauthorized`, with no detail on which.
- The key's default project binds the connection, just as `PROJECT_NAME` does over stdio. It's a
  default, not a boundary: tools still reach other projects through their `project` argument. An
  `X-Project` header, if sent, overrides the key's default.
- The server is stateless, so `pm2 restart task-manager` doesn't break connected sessions; the
  next tool call just works.
- `ui-start` / `ui-stop` aren't offered over HTTP: the server is the UI.
- `health` over HTTP reports `Transport = http` and the number of active keys, and skips the
  Config and Plugin sections, which describe a stdio server's env and the client machine.


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
| `replace` | Swap one exact, unique snippet in description or plan without re-sending the field. |
| `uploadPlan` | Store an absolute-path `.md` file as a task's plan; the server reads it, so plan text never passes through a tool call. Only reads from the project root, `~/.claude/plans/` (where plan mode saves) and the OS temp dir. |
| `addNote` | Append a note to a task without re-sending the description. |
| `updateNote` | Replace one note's text. |
| `deleteNote` | Remove one note. |
| `setStatus` | Move a task through `refinement` → `plan` (opt-in) → `todo` → `in_progress` → `done`. |
| `delete` | Permanently remove a task. |
| `createProject` | Create a new, empty project. Only when you ask for one. |

**Reading**

| Tool | What it does |
|---|---|
| `getNext` | The single recommended next task. |
| `getAll` | Tasks grouped by type. Default: non-done. |
| `getById` | One task by number, including its notes and the titles of linked tasks. A task in an epic also carries the epic's full text; an epic carries its children. |
| `getByType` | Tasks of one type. Default: non-done. |
| `getByScope` | Tasks tagged with a scope. Default: non-done. |
| `getScopes` | All scope tags of the project, with counts. |
| `getProjects` | All projects with total and open counts, plus the session's bound project. |
| `getRelated` | Tasks linked to a given id. Default: non-done. |
| `getOverview` | Per-type counts. Default: non-done. |

#### Status filtering

All read tools (except `getNext`, `getById`, `getScopes`) accept an optional `status` argument:

| Value | Behaviour |
|---|---|
| *(omitted)* | Non-done tasks only — same as `"open"`. **This is the default.** |
| `"open"` | `refinement` + `plan` + `todo` + `in_progress` (everything not done). |
| `"done"` | Completed tasks only. |
| `"refinement"` / `"plan"` / `"todo"` / `"in_progress"` | Exact single-status match. |

Examples: `getAll({ status: "done" })` to see archived work; `getByScope({ scope: "auth", status: "done" })` to see done tasks in a scope.

**Diagnostics & UI control**

| Tool | What it does |
|---|---|
| `health` | Sanity-check the setup; also reports the UI URL and whether a newer version is available. |
| `ui-start` | Start the UI server (idempotent). |
| `ui-stop` | Stop the UI server. |

### Notes — incremental additions to a task

A task can carry any number of notes. Use them for decisions, findings, and spec changes made after refinement — not as a scratchpad or progress log.

- `getById` returns `notes` (oldest first); list tools return only `noteCount`.
- Notes are as authoritative as the description. **The newest statement wins**: a newer note overrides an older one, and any note overrides the description.
- Adding, editing, or deleting a note bumps the task's `updated_at`. Deleting a task deletes its notes.
- `/refine` folds notes back into the description and then deletes them.

### Epics — shared context for a group of tasks

An epic (`type: "epic"`) is an umbrella for a group of tasks. It holds what a fresh session would otherwise have to be told again: the goal, the order of work, the rules. Epics are never implemented directly and `getNext` never returns one.

- Put a task in an epic with `parentId` on `add` or `update`; pass `parentId: null` to take it out. A task has at most one epic.
- The parent must be an epic. Epics cannot be nested, and an epic that still has children cannot be changed to another type. Breaking a rule returns an error and changes nothing.
- `getById` on a child also returns `epic`: the epic's full description and every note, so the agent sees the bigger picture without being told. `getById` on an epic returns `children` (id, title, status, type, priority), ordered by id.
- List tools (`getAll`, `getByType`, `getNext`, …) carry only `parentId` and `epicTitle`, never the epic's text.
- Skills add a note to the epic when a child is committed (`#NN done, commit <sha>`), so the epic accumulates progress for the next session.
- An epic's status follows its children: it moves to `in_progress` when any child does (reopening a done epic), and to `done` once all its children are done, including when the last open child is moved out or deleted. Moving a child back to `todo`/`plan`/`refinement`, or adding a child that hasn't started, leaves the epic as it is. The store does this itself, so the UI and every skill behave the same; `setStatus` reports the change as `epicStatus`.
- Deleting an epic detaches its children; they are kept.

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

### Projects — one database, many repos

Every task belongs to exactly one project, so several repos can share one `tasks.db` without seeing each other's work.

- A session works in the project named by `PROJECT_NAME` in its `.mcp.json`. `getNext`, `getAll`, `getByType`, `getByScope`, `getScopes`, `getOverview` and `add` default to it.
- Pass `project` to any of them to work in another one, e.g. to file a task for a different repo. `update({ id, project })` moves a task.
- Task IDs are global and never renumbered: `getById`, `getRelated`, `setStatus`, notes and refs work across projects, and refs may point into another project.
- Projects are created explicitly (`createProject`, or `+ Project` in the UI). An unknown name is an error that says how to create it; nothing is auto-created. Names are case-insensitive.
- **Zero setup for a single repo:** a database created before projects existed puts every task in a project called `default`. While `default` is the only project, the first MCP start renames it to that repo's `PROJECT_NAME`.
- `health` shows the bound project and whether it exists.
- **Several repos, one DB:** give each repo's `.mcp.json` the same absolute `TASKS_DB` and its own `PROJECT_NAME`, then create those projects. In `standalone` mode, also give them the same `TASK_UI_PORT`; one pm2 UI then serves them all.

### Scope — tagging tasks to an area

Set `scope` on tasks belonging to a specific tool or area (e.g. `"auth"`, `"api"`). Omit for project-wide tasks. Query with `getByScope("auth")` (exact, case-sensitive). Use `getScopes` to list all valid scope values and their open/total counts. Combine with `status` to filter by lifecycle stage.

### Task timestamps

Every task carries two ISO-format timestamp strings:

| Field | Set when |
|---|---|
| `created_at` | Row inserted (immutable) |
| `updated_at` | Any field update or status change. Also serves as the done-time proxy — there is no separate `done_at` column; any later edit to a done task will overwrite the apparent done-time. |

Both fields are returned by all read tools and by the web UI's `/api/tasks` endpoint.


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

- `task-manager-ui not found at … — UI will not be available` — the sub-package is missing or wasn't built. Run `npm install` in the package directory to rebuild, then reconnect the MCP.
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

To try plugin changes (skills, `plugin/RULES.md`, the hook) without installing, load the plugin for
one session with `claude --plugin-dir <dir>/simple-task-manager/plugin`.

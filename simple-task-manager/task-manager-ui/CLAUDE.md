# task-manager-ui

Standalone web UI for the `simple-task-manager` MCP. Sibling package to `simple-task-manager/`. Spawned as a child process by the MCP server on startup so Claude bringing up the MCP also brings up this UI.

## Runtime

- Express HTTP server on port `TASK_UI_PORT` (default **7374**, prints URL to stderr on startup).
- Server runs via tsx — no compile step (`node --import tsx server.ts`). MCP spawns it with `cwd` set to this package so node resolves the `tsx` loader from local `node_modules`.
- Static client bundled by Vite to `dist/`. Built on `npm install` via `prepare`. `dist/` is tracked in git — commit the rebuilt bundle alongside client changes.
- Imports the tasks store directly from `../tasks.js` (the parent simple-task-manager package) via relative path — **no vendor mirror**, no `EXPECTED_MIGRATIONS` validation. Schema changes touch the MCP only; this package picks up the change at next tsx import.

## File layout

| Path | Purpose |
|---|---|
| `server.ts` | Express bootstrap: mounts `/api/tasks`, serves built client from `dist/`, SPA fallback. Reads `TASK_UI_PORT`, `TASKS_DB`, `AUTO_OPEN_TASK_UI`. |
| `src/server/taskStore.ts` | Thin wrapper over the MCP's `createStore`. Adds `isValidationError(err)` helper. |
| `src/server/taskApi.ts` | REST + SSE handlers. Self-write broadcast on every mutation + 1s `data_version` poll for external writes. The 20s SSE heartbeat must stay a named `event: ping`, not a `: ping` comment — `EventSource` never exposes comments, and the `useTasks` watchdog reopens the stream after 45s without one. |
| `src/server/taskRouter.ts` | connect/express middleware that fronts the API. Used by both `server.ts` and the Vite dev plugin. |
| `src/client/*` | The React SPA (TaskManager, TaskCard, TaskForm, useTasks, helpers). Copied from random-tools and stripped of the tool-registry coupling. |
| `src/components/*` | Shared UI: ToolHeader + shadcn primitives (Button, Dialog, Sonner). |
| `src/types/task.ts` | Shared client types — independent of the MCP's tasks.ts to keep the client compile-time clean. Shape must stay aligned. |
| `vite.config.ts` | Vite plugin mounts the task API on the dev middleware stack so `vite` is enough for full-stack dev. |

## Epics

`Task.parentId`/`epicTitle` come from the store's list reads. `lib/taskView.ts` `nestEpicChildren` nests a child under its epic only when the epic is in the same rendered list (section), so other groupings, scopes and the Done tab show the child flat with an `EPIC #N` pill. `epicProgress` counts done/total over active+done so it doesn't change with the tab. Nested children hang off a tree rail (`EPIC_RAIL` in `TaskManager.tsx`: each child draws its own segment + tick, so the nesting stays legible after the epic scrolls away), and the epic card is `sticky top-0` while its children are shown — but not while the card is expanded, since it can outgrow the viewport. Epic collapse state reuses `collapseState` under key `epic:<id>`; `useRefNavigation` expands the epic before scrolling to a nested child. `TaskForm` hides the parent picker for epics and forces `parentId: null`; the store's epic rules arrive as HTTP 400 and `useTasks` keeps the `Validation failed: …` reason so the save toast can show it.

## Env vars

| Name | Default | Purpose |
|---|---|---|
| `TASKS_DB` | `./tasks.db` from cwd | Path to the SQLite database. The MCP forwards its own value when spawning. |
| `TASK_UI_PORT` | `7374` | HTTP port. |
| `AUTO_OPEN_TASK_UI` | unset | When `"1"`, open the printed URL in the system browser on startup. |
| `TASK_UI_DISABLE` | unset | Read by the **MCP**, not this server. When `"1"`, the MCP skips spawning this UI. Useful for tests and for running the UI manually. |

## Logging convention

The MCP spawns this server with `stdio: ['ignore', 'pipe', 'pipe']` and pipes both stdout and stderr to its own **stderr** — stdout in the MCP is reserved for JSON-RPC. The server itself writes startup info to stderr for the same reason: future-proofing in case anything ever spawns it on a stdio that mixes channels.

## Tests

- `*.test.ts` co-located with source — run via vitest (Node environment, no DOM).
- `src/test/setup.ts` redirects `TASKS_DB` to a fresh tmpdir before every test so no test can touch the user's real DB.
- Server tests call `createTaskStore({ dbPath })` directly with a tmp file — migrations run automatically inside the imported `createStore` from the MCP, so no test bootstrap helper is needed.

## When the MCP's schema changes

`tasks.ts` is imported live from `../tasks.ts` (parent package, via the `.js` specifier; tsx maps it back to the `.ts` source at runtime). When the MCP's schema changes:

1. Add the migration in `../migrations/` (the parent package).
2. Run `npm run verify` in both `simple-task-manager` and this sub-package.
3. No `EXPECTED_MIGRATIONS` array to update — that lived in the (now-removed) random-tools vendor mirror.

## When the public store surface changes

`taskStore.ts` wraps the MCP store. If the MCP's `Store` interface gains or loses a method that this package uses (today: `load`, `loadWithNotes`, `add`, `update`, `setStatus`, `delete`, `dataVersion`, `close`), update the wrapper in the same commit.

`taskApi.list()` uses `loadWithNotes()` — same as `load()` plus note bodies (oldest first) via one bulk query. MCP list tools keep `load()` (noteCount only); don't switch them, or every list call ships every note body to the model.

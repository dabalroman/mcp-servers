# Public repo

`~/.claude/mcp-servers/` is a **public** GitHub repository. Anything committed is world-readable and permanent (rewriting history later does not unpublish leaked content). Before writing or editing any file here:

1. **Do not commit user-specific paths.** Use `~/` or `<user-home>` in examples — never `/home/<username>/...` or any absolute home path.
2. **Do not commit real project names, task content, DB paths, or host names.** Use placeholders: `/abs/path/tasks.db`, `<project-name>`, `<host>`.
3. **Test fixtures and migration examples use synthetic data only** — invented titles, IDs starting from 1, fake scopes like `example-scope`.
4. **Scrub before every commit.** Run `git diff --staged` and reject anything matching the above.
5. **When in doubt, redact.** A placeholder is always safer than a real value.

---

# simple-task-manager — Setup

When the user asks to "set up the task manager", "install the task manager MCP", or similar:

1. Run this command in the current project directory:
   ```
   npx tsx ~/.claude/mcp-servers/simple-task-manager/install.ts
   ```
   If an existing `.mcp.json` points at the old `server.js` path, the installer rewrites it to `dist/server.js` automatically.
2. Tell the user to restart Claude Code to activate the MCP.

Do not ask for confirmation — just run it.

---

# simple-task-manager — Development

The package is **TypeScript** (strict mode, `noUncheckedIndexedAccess`). Source `.ts` files live at the package root; production runs from `dist/` (built by `tsc`).

After any change to `server.ts`, `instructions.ts`, anything in `mcp/`, `tasks.ts`, `install.ts`, or `CLAUDE.md` — review `simple-task-manager/README.md` and update it to reflect the change. The README is the user-facing source of truth; keep it in sync.

## File layout

- `server.ts` — bootstrap only: env validation, `createStore`, `new McpServer`, `registerTools`, shutdown handlers, `StdioServerTransport`. Also spawns the sibling `task-manager-ui` web app as a child process (see §task-manager-ui spawn below).
- `instructions.ts` — the `INSTRUCTIONS` string surfaced to MCP clients on connect. Edit this when changing user-facing behavioural rules; the prose is reflected in the agent's system prompt.
- `tasks.ts` — SQLite storage layer plus all exported types (`Task`, `Ref`, `Store`, `TaskType`, `TaskStatus`, `TaskPriority`, `AddInput`, `UpdatePatch`, `LoadResult`, `RelatedResult`, `OverviewEntry`, `ScopeEntry`).
- `mcp/shared.ts` — `text` / `errorText`, `toListTask` (list-mode description stripping), `allIdsSorted`, `notFoundError`, the `MCPContent` type, and the zod `refsSchema`.
- `mcp/queryHandlers.ts` — pure `async (store, args) => Promise<MCPContent>` fns for the 9 read tools (`handleGetByType`, `handleGetOverview`, `handleGetNext`, `handleGetAll`, `handleGetById`, `handleGetByScope`, `handleGetRelated`, `handleGetByStatus`, `handleGetScopes`). All handlers are async for uniformity with mutation handlers.
- `mcp/uiChild.ts` — UI child-process state (`uiPkgDir`, `uiServerEntry`, `getUiChild`, `setUiChild`, `initUiChild`, `spawnUi`). Eagerly imported by both `server.ts` and `mcp/mutationHandlers.ts` to break the circular dependency that a dynamic import of `server.ts` would create.
- `mcp/mutationHandlers.ts` — pure handlers for `handleAdd`, `handleUpdate`, `handleSetStatus`, `handleDelete`. `handleSetStatus` enforces the `refinement → todo` summary gate and emits `knowledgeReminder` on `done`; `handleUpdate` emits `summaryReminder` for summary-less refinement tasks.
- `mcp/registerTools.ts` — `registerTools(server, store)` holds every tool name, long description, and zod input schema and wires each tool to its handler. Adding a new tool means adding a handler + a `server.tool(...)` block here.

`server.test.ts` imports the real handlers directly — there is no copied handler logic in tests. Adding a new handler: add it to `mcp/{query,mutation}Handlers.ts`, register it in `mcp/registerTools.ts`, write tests against the imported handler in `server.test.ts`. Query handlers are async — test call sites must `await` them and the enclosing test function must be `async`.

`install.test.ts` tests `serializeMcpConfig`, `isStaleEntry`, and `loadMigrations` from `mcpConfig.ts` and `tasks.ts`. `install.ts` is a top-level script (calls `process.exit`) and cannot be imported; testable logic lives in `mcpConfig.ts` instead. `isStaleEntry` checks for `/dist/server.js` suffix specifically — `endsWith('/server.js')` alone is too broad and would flag the current `dist/server.js` path as stale.

## tsconfig — excluding the UI sub-package

`tsconfig.json` and `tsconfig.test.json` both list `task-manager-ui` in `exclude`. Without that, the MCP's `tsc` walks into the sub-package and tries to compile its `@/*`-aliased / DOM-typed sources with the MCP's NodeNext config, which fails. The sub-package has its own tsconfig (bundler resolution, JSX, DOM lib) and runs its own typecheck in its own `npm run verify`. Keep these worlds separate.

## Toolchain

- TypeScript 5.6+, strict + `noUncheckedIndexedAccess` + `noImplicitOverride` + `noFallthroughCasesInSwitch`. `tsconfig.json` excludes tests from emit; `tsconfig.test.json` extends it and includes them for typecheck only.
- Tests run via `node --import tsx --test "*.test.ts"` — `tsx` strips types on the fly, no precompile.
- `npm run verify` = typecheck + test + build. The pre-commit hook (`~/.claude/mcp-servers/.git/hooks/pre-commit`) bumps version, runs tests, and rebuilds `dist/`.
- `dist/` is `.gitignore`d. Production entry: `node dist/server.js`. The `.mcp.json` template generated by `install.ts` points at `dist/server.js`.
- Tests must import sibling modules with the `.js` extension (NodeNext module resolution) — e.g. `from './tasks.js'` in a `.ts` file resolves to `tasks.ts` at compile time and `dist/tasks.js` at runtime.

## Git repo location

The git repository root is `~/.claude/mcp-servers/`, **not** `~/.claude/mcp-servers/simple-task-manager/`. The `simple-task-manager/` directory has no `.git` of its own — it is a subdirectory of the `mcp-servers` repo. Always run git commands from `~/.claude/mcp-servers/` (or pass `-C ~/.claude/mcp-servers`). The pre-commit hook lives at `~/.claude/mcp-servers/.git/hooks/pre-commit` and is installed by `simple-task-manager/setup-hooks.ts`.

## Storage — SQLite

Tasks live in a single SQLite database. The path comes from the `TASKS_DB` env var. Schema is owned by `tasks.ts`:
- Tables: `meta`, `tasks`, `refs`, `schema_migrations`
- The `tasks` table has an optional `plan TEXT` column (added by migration `20260514120000_add-plan-field`). Agents write plans here via `update({ id, plan })` and read them back via `getById` before implementing.
- Journal mode is `DELETE` (the SQLite default). WAL's mmap'd shm region isn't coherent across host/container bind mounts — readers stay on stale snapshots until checkpoint, which breaks the random-tools API's SSE live updates. DELETE coordinates via POSIX advisory locks on the main DB file, which is bind-mount-safe. Write contention is a non-issue at this scale.
- `tasks.ts` runs migrations on first open. `schema_migrations` records version + name + applied_at; `PRAGMA user_version` is kept in sync with migration count for backward compat but is NOT used as a gating check. The downgrade guard checks for applied names that have no corresponding file on disk.

## Adding a schema change (migration workflow)

1. Create a new file in `migrations/` named `YYYYMMDDHHMMSS_kebab-slug.ts`.
2. Export `export const name = 'YYYYMMDDHHMMSS_kebab-slug'` (must match filename stem exactly — the runner enforces this).
3. Export `export function up(db: Database): void` with the forward-only SQL.
4. Run `npm run verify` in both `simple-task-manager` and `task-manager-ui` before committing.

The runner automatically detects new files, sorts them by name (chronological), and applies any not yet in `schema_migrations`. It rejects DBs that have applied names not found on disk (downgrade guard).

The sibling `task-manager-ui` imports `tasks.ts` directly via a relative path — no vendor mirror, no `EXPECTED_MIGRATIONS` list to update. Schema changes live in this package only.

## Summary field — architecture

The `summary` column exists in the schema (version 1). The token-saving behaviour lives entirely in the **MCP layer** (`mcp/`), not in `tasks.ts`:

- `tasks.ts` always returns complete task objects (both `summary` and `description`). No stripping in the storage layer.
- `mcp/shared.ts` exports a `toListTask(task)` helper that **always drops `plan`** (plans can be long markdown; only `getById` needs them), and additionally drops `description` when `summary` is present. Applied to every list-method result in `mcp/queryHandlers.ts` (getAll, getByStatus, getByScope, getByType, getNext, getRelated outbound/inbound). `getById` and the `getRelated` anchor task always return all fields.
- Adding a new list tool: always apply `.map(toListTask)` to its results inside the handler.
- `handleSetStatus` blocks `refinement → todo` if the task has no summary. `handleUpdate` on a refinement task without summary returns a `summaryReminder` field.
- The refine skill (`~/.claude/commands/refine.md`) generates the summary as step 3b before promoting.

## Env-var schema for `.mcp.json`

The task-manager MCP reads its config from the `mcpServers["task-manager"].env` block in the project's `.mcp.json`. The schema is the single source of truth for both `install.ts` (which writes the file) and `setup-standalone.ts` (which edits it). When you add or rename an env var, update **all of these** in lockstep:

1. `mcpConfig.ts` — `ENV_DOCS` (printed by install.ts after writing `.mcp.json`) and `ENV_ORDER` (canonical position).
2. `install.ts` — the default value in the emitted `entry.env`.
3. The consumer (server.ts / mcp/* / task-manager-ui) — wherever the var is read.
4. `README.md` — the env-var table is the user-facing contract.
5. `mcpConfig.ts` — `LEGACY_ENV_KEYS` (rename hint) when renaming or retiring a var; the `health` tool reads this to flag the old key as ✗ with the hint instead of letting it slide through as "unknown".

`handleHealth` (`mcp/queryHandlers.ts`) iterates `ENV_ORDER` to validate canonical vars and flags anything else against `LEGACY_ENV_KEYS` (✗) or as ⚠ unknown — so health stays honest as long as those two exports are kept current.

Current env vars (canonical order):

| Variable | Type | Owner | Notes |
|---|---|---|---|
| `TASKS_DB` | absolute path | `tasks.ts` | SQLite database file. |
| `PROJECT_NAME` | string | UI + setup-standalone | Big pill in the UI header + browser tab title. Also the pm2 process name in standalone mode. |
| `TASK_UI_PORT` | port number | UI | Default 7374. |
| `TASK_UI_MODE` | enum | `server.ts`, `mcp/*`, UI | `bundled` (default) \| `standalone` \| `disabled`. See "Standalone UI mode" below. |
| `TASK_UI_AUTO_OPEN_IN_BROWSER` | "0" / "1" | UI | Auto-opens the UI in the system browser when "1". |

### `.mcp.json` is strict JSON

Claude Code's project-level MCP loader (the one behind `/doctor`) rejects JSONC — a `//` comment makes it report "MCP config is not a valid JSON" and the MCP fails to load. `serializeMcpConfig` therefore writes pure JSON. Env-var docs reach the user via two channels instead: `install.ts` prints `ENV_DOCS[key]` after writing the file, and the README env-var table is the canonical reference. Don't reintroduce comment emission, and don't add a `stripJsonComments` step to `parseMcpConfig` — both ends are pure JSON.

## task-manager-ui spawn (bundled mode)

In `bundled` mode (the default), `server.ts` spawns `./task-manager-ui/server.ts` as a child process after `createStore` returns. The UI dies with the MCP (SIGTERM on shutdown handlers).

- Spawn command: `node --import tsx server.ts` with `cwd` set to `task-manager-ui/` so node resolves the `tsx` loader from that package's `node_modules`.
- `stdio: ['ignore', 'pipe', 'pipe']` — child's stdout and stderr are piped into the MCP's **stderr** (the MCP's own stdout is owned by JSON-RPC).
- Env forwarded: `TASKS_DB` plus the parent's full env (so `PROJECT_NAME`, `TASK_UI_PORT`, `TASK_UI_MODE`, `TASK_UI_AUTO_OPEN_IN_BROWSER` flow through).
- Missing sibling: if `./task-manager-ui/server.ts` doesn't exist (e.g. fresh checkout where the sibling isn't installed yet), the MCP logs a warning and continues without the UI.
- Shutdown on stdin close: `server.ts` also hooks `process.stdin` `'end'` and `'close'` events to the same shutdown path. Claude Code closes the stdio pipe without sending SIGTERM when its window is closed — the stdin close triggers a clean teardown (killUi + store.close + process.exit) so the MCP and its UI child don't get orphaned on PID 1.

The UI imports the store directly from `./tasks.js` via a relative path (`../simple-task-manager/tasks.js`) — there is **no vendor mirror**. Schema changes affect only this package; the UI picks them up at the next tsx import.

## Standalone UI mode

Per-project opt-in: `TASK_UI_MODE=standalone` in `.mcp.json` flips the MCP from "spawn the UI as a child" to "the UI is a long-lived pm2 process I should ignore." Managed by `setup-standalone.ts on|off` (run from the project dir).

**Why tri-state, not two booleans?** Earlier iterations had `TASK_UI_DISABLE` and `TASK_UI_STANDALONE` as separate `0/1` flags. Mechanically both made the MCP skip the spawn, so the user-facing intent (UI exists vs. doesn't) was hidden behind precedence rules. `TASK_UI_MODE` collapses that into one enum where each value names a distinct lifecycle.

**Spawn logic (`server.ts`)**: switch on `TASK_UI_MODE`. `standalone` and `disabled` both skip `spawnUi()` but log different reasons. Anything else (including unset / unrecognised) falls back to `bundled`.

**`ui-start` / `ui-stop`**:

- `mode === 'standalone'` → return an errorText pointing at `pm2 restart <PROJECT_NAME>` / `pm2 stop <PROJECT_NAME>`. Never proxy to pm2.
- `mode === 'disabled'` (ui-start only) → error explaining to set `TASK_UI_MODE=bundled` and restart.
- `mode === 'bundled'` → real behaviour (probe TCP, spawn, send SIGTERM).

**`health.ui` field**: every `handleHealth` response includes a structured `ui: 'bundled' | 'standalone' | 'disabled'` alongside the human-readable `report`. Resolution:

1. `.mcp.json` parsed successfully → `uiMode` derived from `env.TASK_UI_MODE` (validated against the three-value enum; anything else collapses to `bundled` with a `✗` check line).
2. Early-return branches (no `.mcp.json` or parse failure) → fall back to `resolveUiModeFromProcess()` which reads `process.env.TASK_UI_MODE` with the same validation.

The `Config` section of the report surfaces `TASK_UI_MODE`, `PROJECT_NAME`, and `TASK_UI_AUTO_OPEN_IN_BROWSER` as their own check lines. The `Runtime` section's not-reachable hint is mode-aware: `pm2 status <PROJECT_NAME>` (standalone), "set TASK_UI_MODE=bundled" (disabled), "is the MCP running?" (bundled).

### How the UI itself learns its mode

The browser-side `App.tsx` needs to render the `bundled mode` / `standalone mode` label under the project name. The UI server reads `process.env.TASK_UI_MODE` and exposes it via `GET /api/config`, which also carries `PROJECT_NAME` for the header pill. Client fetches `/api/config` on mount, sets `document.title`, and renders both.

For this to work in standalone mode, the generated `ecosystem.task-ui.config.cjs` must include `TASK_UI_MODE: 'standalone'` in its `env` block — pm2 doesn't inherit the MCP's `.mcp.json` env (the MCP isn't even running yet when pm2 starts the UI on boot). `setup-standalone.ts` bakes this into the generated file.

### Setup script — `setup-standalone.ts`

Lives at the package root next to `install.ts`. Two subcommands:

- `on` — patches `.mcp.json` (sets `TASK_UI_MODE='standalone'`, ensures `PROJECT_NAME` / `TASK_UI_PORT` / `TASKS_DB`), generates `<project>/ecosystem.task-ui.config.cjs`, runs `pm2 delete <PROJECT_NAME>` (ignored on failure) followed by `pm2 start ./ecosystem.task-ui.config.cjs && pm2 save`.
- `off` — runs `pm2 delete <PROJECT_NAME>`, sets `TASK_UI_MODE='bundled'`, removes the generated ecosystem file.

The generated `ecosystem.task-ui.config.cjs` bakes in the values from `.mcp.json` at generation time: `name`, absolute `cwd` pointing at `task-manager-ui/`, `script: 'server.ts'`, `interpreter: 'node'`, `interpreter_args: '--import tsx'`, and an `env` block with `TASKS_DB` + `PROJECT_NAME` + `TASK_UI_PORT` + `TASK_UI_MODE='standalone'`. The file lives **in the project directory** (next to `.mcp.json`), not in this package — each opted-in project owns its own copy.

**pm2 config-file detection** is filename-based: the file *must* match `*.config.{js,cjs}` for pm2 to read `apps[]`. Naming the file `ecosystem.task-ui.cjs` (without `.config.`) makes pm2 treat it as a script — the process ends up named after the file, ignoring `apps[].name`. Don't drop the `.config.` segment.

Editing `.mcp.json` after `on` and want it to take effect? Re-run `setup-standalone.ts on` to regenerate.

## Consumers of the `Store` surface

`tasks.ts` is the only source of the SQLite store. Two consumers:

- `mcp/*` — JSON-RPC tools registered onto the McpServer. Imports `createStore`, `Store`, and the typed inputs/outputs directly.
- `./task-manager-ui/src/server/taskStore.ts` — thin async wrapper used by the web UI. Imports `createStore`, `AddInput`, `UpdatePatch`, `LoadResult`, `Store` via `'../../../tasks.js'` (climbs out of `task-manager-ui/` to the parent package root).

When you add/rename/remove a method on `Store`, the UI wrapper in `task-manager-ui/src/server/taskStore.ts` may need a corresponding edit. There is no compile-time link between the two packages, so it pays to grep `task-manager-ui` for the old method name before declaring done.

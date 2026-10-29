# Public repo

`~/.claude/mcp-servers/` is a **public** GitHub repository. Anything committed is world-readable and permanent (rewriting history later does not unpublish leaked content). Before writing or editing any file here:

1. **Do not commit user-specific paths.** Use `~/` or `<user-home>` in examples — never `/home/<username>/...` or any absolute home path.
2. **Do not commit real project names, task content, DB paths, or host names.** Use placeholders: `/abs/path/tasks.db`, `<project-name>`, `<host>`.
3. **Test fixtures and migration examples use synthetic data only** — invented titles, IDs starting from 1, fake scopes like `example-scope`.
4. **Scrub before every commit.** Run `git diff --staged` and reject anything matching the above.
5. **When in doubt, redact.** A placeholder is always safer than a real value.

---

# simple-task-manager — Development

**These are dev docs and they are deliberately not imported globally** — they load only when working
in this repo. Content reaches an agent through three channels, and mixing them is a real cost:

| Channel | Loads | Holds |
|---|---|---|
| `instructions.ts` | on MCP connect | core usage rules only (lifecycle, refinement-by-default, notes) — hard cap 4,096 chars |
| `plugin/RULES.md` | SessionStart hook of the `task-manager` plugin, only in repos whose `.mcp.json` has a `task-manager` entry | extended rules: epics, getNext order, prefixes, pipeline, refs, status filtering, scope, knowledge capture, repo binding — cap 10,000 chars |
| `CLAUDE.md` (this file) | on demand, when working in this repo | everything about developing the package |

Claude Code cuts MCP server instructions at 4,096 chars and SessionStart hook output at 10,000 (beyond it only a 2,000-char preview shows). Both caps are asserted in `server.test.ts`. A rule lives in exactly one of the two files; anything new goes to `RULES.md` unless every session without the plugin must have it.

### Plugin (`plugin/`)
- Layout: `.claude-plugin/plugin.json`, `skills/<name>/SKILL.md` (the 4 skills, single source), `hooks/hooks.json`, `hooks/session-rules.mjs`, `RULES.md`. The marketplace is `.claude-plugin/marketplace.json` at the repo root (name `dabalroman`); `marketplace add owner/repo` reads only that path.
- `plugin/` must be self-contained: a git-marketplace install copies only that folder into the plugin cache. No `../` references, no symlinks out, no `CLAUDE.md` inside it (not loaded; validate warns).
- No `version` in plugin.json on purpose: with one, users stay pinned until it changes; without, git installs update per commit and a local-path marketplace loads in place. `claude plugin validate` warns about it — expected.
- The hook is exec-form `node` + `args`, not a shell one-liner: shell-form hooks run in PowerShell on Windows when Git Bash is missing. The script is `.mjs` (not TS) because it runs unbuilt from the cache; it locates `RULES.md` via `$CLAUDE_PLUGIN_ROOT`, which changes on every plugin update — never cache it. It strips a UTF-8 BOM before parsing `.mcp.json` (Windows editors write one). The binding counts if `$CLAUDE_PROJECT_DIR/.mcp.json`, or `~/.claude.json` at user scope (top-level `mcpServers`) or local scope (`projects[<dir>].mcpServers`), has a `task-manager` entry. Each read fails to "not bound", and tests set `HOME` to a tmp dir.
- The plugin carries no MCP entry: project binding is per repo (`.mcp.json`) and plugin config (`pluginConfigs`) is user/managed-scope only; a plugin MCP would also connect in unbound repos.
- Skill names: write the bare form (`/implement`) in docs, rules and the UI — a plugin skill resolves bare **only when its SKILL.md sets frontmatter `name`** (directory name alone gives just `/task-manager:<skill>`; verified 2.1.311) and no other command owns the name, so keep `name:` on every skill. `/task-manager:implement` always works. Only Skill-tool invocations inside skills use the listed `task-manager:<skill>` name.
- Auto-update is off by default for third-party marketplaces; the README tells users how to enable it.
- Dev loop: `claude --plugin-dir <repo>/simple-task-manager/plugin`.
- User-facing hints are built from `PACKAGE_DIR` (`packageDir.ts`, works from source and `dist/`) — never hard-code the clone location.

The package is **TypeScript** (strict mode, `noUncheckedIndexedAccess`). Source `.ts` files live at the package root; production runs from `dist/` (built by `tsc`).

After any change to `server.ts`, `instructions.ts`, anything in `mcp/`, `tasks.ts`, `install.ts`, `plugin/` (skills, RULES.md, hook), or `CLAUDE.md` — review `simple-task-manager/README.md` and update it to reflect the change. The README is the user-facing source of truth; keep it in sync.

## File layout

- `server.ts` — bootstrap only: env validation, `createStore`, `new McpServer`, `registerTools`, shutdown handlers, `StdioServerTransport`. Also spawns the sibling `task-manager-ui` web app as a child process (see §task-manager-ui spawn below).
- `instructions.ts` — the `INSTRUCTIONS` string surfaced to MCP clients on connect. Edit this when changing user-facing behavioural rules; the prose is reflected in the agent's system prompt.
- `tasks.ts` — SQLite storage layer plus all exported types (`Task`, `Note`, `Ref`, `Store`, `TaskType`, `TaskStatus`, `TaskPriority`, `AddInput`, `UpdatePatch`, `LoadResult`, `RelatedResult`, `OverviewEntry`, `ScopeEntry`).
- `mcp/shared.ts` — `text` / `errorText`, `toListTask` (list-mode description stripping), `allIdsSorted`, `notFoundError`, the `MCPContent` type, and the zod `refsSchema`.
- `mcp/queryHandlers.ts` — pure `async (store, args[, ctx]) => Promise<MCPContent>` fns for the read tools (project-aware ones take `ctx: SessionContext`, see §Projects) (`handleGetByType`, `handleGetOverview`, `handleGetNext`, `handleGetAll`, `handleGetById`, `handleGetByScope`, `handleGetRelated`, `handleGetByStatus`, `handleGetScopes`). All handlers are async for uniformity with mutation handlers.
- `mcp/uiChild.ts` — UI child-process state (`uiPkgDir`, `uiServerEntry`, `getUiChild`, `setUiChild`, `initUiChild`, `spawnUi`). Eagerly imported by both `server.ts` and `mcp/mutationHandlers.ts` to break the circular dependency that a dynamic import of `server.ts` would create.
- `mcp/mutationHandlers.ts` — pure handlers for `handleAdd`, `handleUpdate`, `handleReplace`, `handleUploadPlan`, `handleAddNote` / `handleUpdateNote` / `handleDeleteNote`, `handleSetStatus`, `handleDelete`. `handleSetStatus` enforces the `refinement → todo` summary gate and emits `knowledgeReminder` on `done`; `handleUpdate` emits `summaryReminder` for summary-less refinement tasks and echoes the task without `plan` and with `noteCount` instead of note bodies (use `getById` for both). `handleReplace` counts overlapping matches by stepping 1 char and splices with `slice`, not `String.replace`, so `$&` in `replace_with` stays literal; a replace that empties the plan clears it to `null` because `store.update` trims. Unknown note ids return `Note #N not found.` without listing ids.
- `mcp/http.ts` — `createMcpHttpHandler({ store })`: the Streamable HTTP MCP at `/mcp` (#361). Plain `node:http` types, no express, so `http.test.ts` (node:test) drives it directly. Order: API key (401, same body for missing/wrong/revoked, `WWW-Authenticate: Bearer` with no OAuth `resource_metadata` — Claude Code would start OAuth), POST only (405), project = `X-Project` header or else the key's default project (400 if neither), then a fresh `McpServer` + stateless `StreamableHTTPServerTransport` per request. The transport reads the body itself — don't put a body parser in front of it. No loopback exemption (a TLS proxy forwards from 127.0.0.1) and no Host check (DNS rebinding can't supply the key; a Host list would block LAN and proxied clients).
- `mcp/registerTools.ts` — `registerTools(server, store, ctx)` holds every tool name, long description, and zod input schema and wires each tool to its handler. Adding a new tool means adding a handler + a `server.tool(...)` block here.
- `updateCheck.ts` — `checkForUpdate(deps?)` compares the local `VERSION` against the `version.ts` on `main` of this repo (raw GitHub URL, 5s timeout), cached in-memory for 1h with concurrent callers sharing one in-flight fetch; failures of any kind are cached as `state: 'unknown'`, never thrown. `fetchImpl`/`now` are optional deps for tests; `resetUpdateCheckCache()` clears the cache between tests. Consumed by `mcp/queryHandlers.ts` (`health`'s Version section), `server.ts` (one startup log line when `available`), and `task-manager-ui/server.ts` (`/api/config`).

`server.test.ts` imports the real handlers directly — there is no copied handler logic in tests. Adding a new handler: add it to `mcp/{query,mutation}Handlers.ts`, register it in `mcp/registerTools.ts`, write tests against the imported handler in `server.test.ts`. Query handlers are async — test call sites must `await` them and the enclosing test function must be `async`.

`install.test.ts` tests `serializeMcpConfig`, `isStaleEntry`, `parseInstallArgs` (runs before the build; rejects unknown flags and `--global`), and `loadMigrations` from `mcpConfig.ts` and `tasks.ts`. `install.ts` is a top-level script (calls `process.exit`) and cannot be imported; testable logic lives in `mcpConfig.ts` instead. `isStaleEntry` checks for `/dist/server.js` suffix specifically — `endsWith('/server.js')` alone is too broad and would flag the current `dist/server.js` path as stale.

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

Every commit that implements or closes a task-manager task **must use this subject format**: `#<id>/<type>/<scope>: <description>`, e.g. `#172/fix/task-manager: always sync skills`. This keeps git history traceable back to the task that motivated the change.

## Storage — SQLite

Tasks live in a single SQLite database. The path comes from the `TASKS_DB` env var. Schema is owned by `tasks.ts`:
- Tables: `tasks`, `refs`, `notes`, `projects`, `api_keys`, `schema_migrations` (plus `sqlite_sequence`, owned by SQLite).
- The `tasks` table uses `INTEGER PRIMARY KEY AUTOINCREMENT` — ids come from SQLite (via `lastInsertRowid` on insert) and are stored in `sqlite_sequence`. The earlier `meta.counter` scheme drifted whenever an external writer inserted a row without bumping the counter and was dropped in `20260519000000_drop-meta-counter-autoincrement-tasks`. Deleted ids are never reused (the AUTOINCREMENT high-water mark guarantees this).
- The `tasks` table has an optional `plan TEXT` column (added by migration `20260514120000_add-plan-field`). Agents store plans with `uploadPlan({ id, path })` (server reads an absolute `.md`; `mcp/planPath.ts` confines reads to the project root (dirname of `TASKS_DB`), `~/.claude/plans/` and `os.tmpdir()`, resolving both roots and target with `realpathSync.native` — follows symlinks and expands Windows 8.3 short names — and testing containment with `path.relative`, which is case-insensitive on win32 and absolute across drives; rejects non-`.md`, non-regular, unreadable and whitespace-only files — `store.update` would turn whitespace-only into `null`, silently clearing the plan) and read them back via `getById` before implementing. The DB copy is canonical; the `.md` is scratch. `update({ plan })` still works for small inline plans.
- `notes` (`id`, `task_id` → `tasks` ON DELETE CASCADE, `body`, `created_at`, `updated_at`; index on `task_id`, migration `20261012120000_add-notes`). `readTask` also adds each ref's target `title` (one JOIN; list reads via `attachRefs` stay title-free, and the zod `refsSchema` strips `title` on input so echoed refs round-trip). It attaches full `notes` ordered `created_at ASC, id ASC`; `attachRefs` adds `noteCount` via one grouped COUNT, so list reads and `load()` get counts, never bodies. Both fields are omitted when a task has no notes. Each note mutation bumps the parent's `updated_at` in the same transaction. Precedence: newest statement wins — a newer note beats an older one, any note beats the description; `/refine` folds notes into the description and deletes them.
- Epics (#312, migration `20261020120000_add-epic-type-and-parent`): `type: 'epic'` is a context umbrella; `tasks.parent_id` is a nullable self-FK `REFERENCES tasks(id) ON DELETE SET NULL` (index `idx_tasks_parent_id`), so deleting an epic detaches its children. In the rebuild the self-FK must be written `tasks(id)`, not `tasks_new(id)` — SQLite doesn't repoint a self-reference on RENAME; `migrations.test.ts` asserts `foreign_key_list(tasks)` targets `tasks`. `assertParent` (inside the add/update transaction, only when a patch touches `type` or `parentId`) throws `Validation failed: …` for: parent missing, parent not an epic, epic with a parent (no nesting; also blocks retyping a child into an epic), retyping an epic that still has children. `parentId: null` clears, `undefined` keeps.
- Epic injection lives in `getById` only, not `readTask` — `update()` and `getRelated` reuse `readTask` and the update echo must stay slim. A child gets `epic` (full text + all notes), an epic gets `children`. List reads and `readTask` carry only `parentId` + `epicTitle` (one bulk title query in `attachRefs`); `toListTask` strips `epic`/`children` as a guard. `getNext` excludes epics in SQL. `syncEpicStatus` runs inside the store transaction of `setStatus` (only on a real status change), `add` with a `parentId`, `update` that changes `parentId` (old epic and new) and `delete` of a child: a child going `in_progress` moves the epic to `in_progress` (reopening a done epic); the epic closes when it has children and all are done; moving a child back to `todo`/`plan`/`refinement` leaves the epic as it is. It lives in the store, not the handler, so UI changes sync too. `handleSetStatus` runs in one `store.db.transaction` (better-sqlite3 nests it as a savepoint) and reports a change as `epicStatus` by comparing the epic's status before and after.
- External ticket ID (#366, migration `20261027120000_add-external-id`): nullable `external_id` with index `idx_tasks_external_id` on `lower(external_id)`. `Task.externalId` is the one optional that is **always present** (`null` when unset) — `rowToTask` sets it in the literal; don't move it to the `if (row.x)` pattern, agents rely on the key. Not unique (an epic and its children may share one). `getByExternalId` is case-insensitive exact (`lower()` = ASCII-only folding), all statuses incl. done, sorted by id.
- Projects (#360, migration `20261027130000_add-projects`): `projects(name TEXT PRIMARY KEY COLLATE NOCASE, created_at)`; `tasks.project TEXT NOT NULL COLLATE NOCASE REFERENCES projects(name) ON UPDATE CASCADE`, index `idx_tasks_project`, **no column default** (a store bug must fail, not file into `default`). Both columns are NOCASE so list filters match any spelling; writes still go through `canonicalProject`, which stores the projects-table spelling (the NOCASE FK would otherwise accept and keep the caller's casing). The migration files everything under the literal `default` and never reads env, because whichever process opens the DB first (UI or any MCP) runs it. `adoptDefaultProject(PROJECT_NAME)` runs on MCP startup only (never the UI, which ignores PROJECT_NAME): when `default` is the sole project it renames it, and the FK cascade moves the tasks. Unknown projects are a `Validation failed` error from the store, never auto-created.
  - Binding: `server.ts` builds `ctx = { project: PROJECT_NAME || 'default' }` and passes it to `registerTools`; HTTP builds `{ project: X-Project ?? key's default project, transport: 'http' }` per request. `ctx.transport === 'http'` skips `ui-start`/`ui-stop`, makes health collapse Config/Plugin into one `–` line (process.env is the UI server's, not the client's), and points the unknown-project hint at the header. Project-aware handlers (`getNext`, `getAll`, `getByType`, `getByScope`, `getScopes`, `getOverview`, `add`) call `resolveProject(store, ctx, args.project)` in `mcp/shared.ts`, which returns the name or an `errorText`. Store list methods take `project` as their **first, required** parameter so an unfiltered call can't compile.
  - Global on purpose (IDs are global): `getById`, `getRelated`, `getByExternalId` (a ticket ID is an identifier lookup), `setStatus`, `delete`, notes, refs, epic links, and `load()`/`loadWithNotes()`. The UI loads everything and filters on the client (`filterByProject` in `src/lib/taskView.ts`), so `/api/tasks` and `/stream` stay project-agnostic; `GET/POST /api/projects` lists and creates projects.
  - UI selection (#369): the URL's first path segment is the project (`projectFromPath`/`projectPath` in `taskView.ts`), plain History API, no router. URL beats localStorage on load; `selectProject` pushes, an effect `replaceState`s `/`, miscased or unknown names to the canonical path, `popstate` follows Back/Forward. Deep links work only because `server.ts` (and Vite's default `appType: 'spa'`) fall back to `index.html` and assets are absolute — keep both.
  - The project rule for agents lives in `plugin/RULES.md` (INSTRUCTIONS has no room); plugin-less sessions get it from the `project` param descriptions.
- Table-rebuild migrations must restore `sqlite_sequence`: `DROP TABLE tasks` deletes its row and the rebuild reseeds it from the highest *surviving* id, so the ids of deleted top tasks would be handed out again. `add-projects` reads `seq` before and writes `max(old, new)` back; the older rebuilds didn't (already applied, left alone).
- Migration tests that seed "every migration before X" must filter `m.name < X`, not `m.name !== X` — the latter also applies every *later* migration before X runs, which a table-rebuild migration then silently drops.
- Journal mode is `DELETE` (the SQLite default). WAL's mmap'd shm region isn't coherent across host/container bind mounts — readers stay on stale snapshots until checkpoint, which breaks the random-tools API's SSE live updates. DELETE coordinates via POSIX advisory locks on the main DB file, which is bind-mount-safe. Write contention is a non-issue at this scale.
- `tasks.ts` runs migrations on first open. `schema_migrations` records version + name + applied_at; `PRAGMA user_version` is kept in sync with migration count for backward compat but is NOT used as a gating check. The downgrade guard checks for applied names that have no corresponding file on disk and throws `StaleSchemaError` (`staleSchemaMessage` carries the rebuild/restart fix).
- Connection pragmas (set in `createStore`): `journal_mode=DELETE` (see above), `busy_timeout=5000` (DELETE journaling raises immediate `SQLITE_BUSY` without this; the health-handler's read-only connection uses `2000`), `foreign_keys=ON` (wrapped in `try/finally` around `runMigrations` so a thrown migration can't leave the connection with FK enforcement off — would silently break the `refs` ON DELETE CASCADE).
- `runMigrations` body is wrapped in a single `BEGIN IMMEDIATE` transaction so two processes calling `createStore` on a fresh DB serialise on the write lock instead of both racing into duplicate `schema_migrations` INSERTs (the bundled-mode UI spawns right after the MCP's `createStore`). The loser waits on `busy_timeout`, then sees the populated table and the loop becomes a no-op.
- **Pre-migration backup (#368):** inside that transaction, once pending migrations are known and before the first `up()`, a non-fresh file DB is copied (`copyFileSync`, `COPYFILE_EXCL`) to `<db>.backup-<local stamp>-pre-<first pending>`, with one stderr line. It must stay a file copy under the lock: `VACUUM INTO` can't run inside a transaction, and a backup taken before the lock races (every opener would copy). The copy is consistent because `journal_mode=DELETE` leaves the main file untouched until commit. A failed copy throws, so nothing is migrated. Backups are never pruned.
- **Stale-schema guard during a session (#368):** another process can migrate the DB while this one runs, and the open-time check can't see that. Every Store write method calls `assertSchemaCurrent()` first (one `SELECT` on `schema_migrations` against the names `runMigrations` returned). Reads are deliberately allowed. A new write method must call it too. The MCP's `withSchemaCheck` (`mcp/shared.ts`, wrapping every tool in `registerTools`) turns `StaleSchemaError` into a tool error and appends a ⚠ restart line to read results. The UI router maps it to 409, and the client shows the message via `failureReason`.

## Adding a schema change (migration workflow)

1. Create a new file in `migrations/` named `YYYYMMDDHHMMSS_kebab-slug.ts`.
2. Export `export const name = 'YYYYMMDDHHMMSS_kebab-slug'` (must match filename stem exactly — the runner enforces this).
3. Export `export function up(db: Database): void` with the forward-only SQL.
4. Run `npm run verify` in both `simple-task-manager` and `task-manager-ui` before committing.

The runner automatically detects new files, sorts them by name (chronological), and applies any not yet in `schema_migrations`. It rejects DBs that have applied names not found on disk (downgrade guard).

**FKs are OFF during the migration loop.** `runMigrations` disables `foreign_keys` before applying anything and re-enables it after, then runs `PRAGMA foreign_key_check` to surface any violations. Without this, table-rebuild migrations (CREATE-new / INSERT…SELECT / DROP / RENAME) trigger ON DELETE CASCADE on dependent tables during the DROP and wipe `refs` and `notes`. If your migration only ALTERs columns this doesn't matter; if it rebuilds a table, rely on this — don't try to toggle `foreign_keys` inside `up()` (no-op inside a transaction).

The sibling `task-manager-ui` imports `tasks.ts` directly via a relative path — no vendor mirror, no `EXPECTED_MIGRATIONS` list to update. Schema changes live in this package only.

**Widening a CHECK-constrained enum** (e.g. adding a new `status` or `type` value) requires a full table rebuild — SQLite cannot ALTER a CHECK constraint in place. The `20260519010000_add-plan-status` migration is the canonical pattern: CREATE TABLE `tasks_new` with the expanded constraint, `INSERT … SELECT … FROM tasks ORDER BY id`, DROP old table, RENAME, recreate indexes. Rely on the FK-off contract above so the DROP doesn't cascade-wipe `refs`. Don't forget to add the new value to every enumeration site: the `TaskStatus`/`TaskType` union in `tasks.ts`, the zod schemas in `mcp/registerTools.ts`, the duplicated union in `task-manager-ui/src/types/task.ts`, plus UI constants (`TYPES`/`TYPE_ORDER`/`TYPE_LABELS` in `src/client/constants.ts` and the private `TYPE_ORDER` in `src/lib/taskView.ts` for a type; `STATUS_LABELS`, `STATUS_NEXT`, `STATUS_CLASSES`, `STATUS_RANK`, `STATUS_ORDER`, `STATUSES`, `INITIAL_STATUSES`).

## Summary field — architecture

The `summary` column exists in the schema (version 1). The token-saving behaviour lives entirely in the **MCP layer** (`mcp/`), not in `tasks.ts`:

- `tasks.ts` always returns complete task objects (both `summary` and `description`). No stripping in the storage layer.
- `mcp/shared.ts` exports a `toListTask(task)` helper that **always drops `plan` and `notes`** (both can be long; only `getById` needs them — lists carry `noteCount`), and additionally drops `description` when `summary` is present. Applied to every list-method result in `mcp/queryHandlers.ts` (getAll, getByStatus, getByScope, getByType, getNext, getRelated anchor + outbound/inbound). `getRelated` applies it to the anchor task too (with `noteCount` from its notes); only `getById` returns all fields.
- Adding a new list tool: always apply `.map(toListTask)` to its results inside the handler.
- `handleSetStatus` blocks `refinement → todo` if the task has no summary. `handleUpdate` on a refinement task without summary returns a `summaryReminder` field.
- The refine skill (`plugin/skills/refine/SKILL.md`) generates the summary as step 3b before promoting.

## Env-var schema for `.mcp.json`

The task-manager MCP reads its config from the `mcpServers["task-manager"].env` block in the project's `.mcp.json`. The schema is the single source of truth for both `install.ts` (which writes the file) and `setup-standalone.ts` (which edits it). When you add or rename an env var, update **all of these** in lockstep:

1. `mcpConfig.ts` — `ENV_DOCS` (printed by install.ts after writing `.mcp.json`) and `ENV_ORDER` (canonical position).
2. `install.ts` — the default value in the emitted `entry.env`.
3. The consumer (server.ts / mcp/* / task-manager-ui) — wherever the var is read.
4. `README.md` — the env-var table is the user-facing contract.
5. `mcpConfig.ts` — `LEGACY_ENV_KEYS` (rename hint) when renaming or retiring a var; the `health` tool reads this to flag the old key as ✗ with the hint instead of letting it slide through as "unknown".

`handleHealth` (`mcp/queryHandlers.ts`) validates the canonical `ENV_ORDER` vars from **`process.env`** (what the server actually received; user/local-scope bindings have no `.mcp.json`). It scans a `.mcp.json` found above the cwd only for keys flagged against `LEGACY_ENV_KEYS` (✗) or as ⚠ unknown, so health stays honest as long as those two exports are kept current. A missing `.mcp.json` is not an error. The **Plugin** section reads `~/.claude/plugins/installed_plugins.json`, `settings.json` `enabledPlugins`, the old `~/.claude/commands/{refine,implement,implement-as-coordinator,assess}.md` copies (they shadow the plugin's bare skill names) and a dangling `@…/SETUP.md` import. `handleHealth(binding, { homeDir })` lets tests point it at a tmp home.

Current env vars (canonical order):

| Variable | Type | Owner | Notes |
|---|---|---|---|
| `TASKS_DB` | absolute path | `tasks.ts` | SQLite database file. |
| `PROJECT_NAME` | string | `server.ts` (binding), setup-standalone (fills a default) | The session's bound project (unset → `default`; adopts a lone `default` project on MCP start). Not used by the UI or the pm2 app name (#370). |
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

- `mode === 'standalone'` → return an errorText pointing at `pm2 restart <pm2AppName(TASK_UI_PORT)>` / `pm2 stop …`. Never proxy to pm2.
- `mode === 'disabled'` (ui-start only) → error explaining to set `TASK_UI_MODE=bundled` and restart.
- `mode === 'bundled'` → real behaviour (probe TCP, spawn, send SIGTERM).

**`health.ui` field**: every `handleHealth` response includes a structured `ui: 'bundled' | 'standalone' | 'disabled'` alongside the human-readable `report`. Resolution:

1. `.mcp.json` parsed successfully → `uiMode` derived from `env.TASK_UI_MODE` (validated against the three-value enum; anything else collapses to `bundled` with a `✗` check line).
2. Early-return branches (no `.mcp.json` or parse failure) → fall back to `resolveUiModeFromProcess()` which reads `process.env.TASK_UI_MODE` with the same validation.

The `Config` section of the report surfaces `TASK_UI_MODE`, `PROJECT_NAME`, and `TASK_UI_AUTO_OPEN_IN_BROWSER` as their own check lines. The `Runtime` section's not-reachable hint is mode-aware: `pm2 status <pm2AppName(port)>` (standalone), "set TASK_UI_MODE=bundled" (disabled), "is the MCP running?" (bundled).

### How the UI itself learns its mode

The browser-side `App.tsx` renders the `bundled mode` / `standalone mode` label in the header. The UI server reads `process.env.TASK_UI_MODE` and exposes it via `GET /api/config`; the client fetches it on mount. There is no project label (#370): one UI serves every project on its DB and the project tabs show the active one, so a per-repo label was wrong whenever repos shared a UI. The page title is the static one in `index.html`.

`/api/config` is auth-less and reachable by any LAN client. Keep its payload minimal — `{mode, version, packageDir, update}`. `packageDir` is the one deliberate path (#365: copyable commands in the mode/update dialogs; the same UI already serves task text containing host paths). Don't add other filesystem paths (e.g. `TASKS_DB`), credentials, or anything host-identifying; they'd leak the host's username + directory layout to anything that can reach :7374.

For this to work in standalone mode, the generated `ecosystem.task-ui.config.cjs` must include `TASK_UI_MODE: 'standalone'` in its `env` block — pm2 doesn't inherit the MCP's `.mcp.json` env (the MCP isn't even running yet when pm2 starts the UI on boot). `setup-standalone.ts` bakes this into the generated file.

### Setup script — `setup-standalone.ts`

Lives at the package root next to `install.ts`. Two subcommands:

- `on` — patches `.mcp.json` (sets `TASK_UI_MODE='standalone'`, ensures `PROJECT_NAME` / `TASK_UI_PORT` / `TASKS_DB`). **Join**: if this repo has no ecosystem file and `GET localhost:<port>/api/config` answers with a `mode`, it stops there; the repo shares the running UI. **Own**: otherwise it generates `<project>/ecosystem.task-ui.config.cjs`, rebuilds `dist/`, deletes `pm2AppName(port)` plus any legacy UI app on the same port, then `pm2 start <file> && pm2 save`.
- `off` — sets `TASK_UI_MODE='bundled'`. Only the owner (ecosystem file present) also deletes the pm2 app(s) and the file; a joined repo leaves the shared UI running.

**pm2 app name = `pm2AppName(port)`** (`mcpConfig.ts`): `task-manager` on 7374, `task-manager-<port>` otherwise. It follows the port, not PROJECT_NAME (#370): one UI serves every project on its DB, and only one UI can bind a port, so the port is the natural unique key. The UI mirrors it in `task-manager-ui/src/lib/pm2.ts` from `window.location.port` (the browser bundle can't import `mcpConfig.ts`); the update badge and the run-mode modal use it. **Legacy apps** (pre-#370 per-repo names) are found via `pm2 jlist` by script path (`task-manager-ui/server.ts`) **and** `pm2_env.TASK_UI_PORT`, never by name, so an unrelated pm2 app that shares a project's name, or a UI on another port, is never deleted.

The generated `ecosystem.task-ui.config.cjs` bakes in the values from `.mcp.json` at generation time: `name`, absolute `cwd` pointing at `task-manager-ui/`, `script: 'server.ts'`, `interpreter: 'node'`, `interpreter_args: '--import tsx'`, and an `env` block with `TASKS_DB` + `TASK_UI_PORT` + `TASK_UI_MODE='standalone'`. The file lives **in the owning project's directory** (next to `.mcp.json`), not in this package.

**pm2 restart keeps the old env**: after an env change in the ecosystem file, `pm2 restart <file> --update-env` (or delete + start). Re-running `setup-standalone.ts on` already does delete + start.

**pm2 config-file detection** is filename-based: the file *must* match `*.config.{js,cjs}` for pm2 to read `apps[]`. Naming the file `ecosystem.task-ui.cjs` (without `.config.`) makes pm2 treat it as a script — the process ends up named after the file, ignoring `apps[].name`. Don't drop the `.config.` segment.

Editing `.mcp.json` after `on` and want it to take effect? Re-run `setup-standalone.ts on` to regenerate.

## MCP over HTTP (`/mcp`)

`task-manager-ui/server.ts` mounts `/mcp` in every UI mode (standalone pm2 `pm2AppName(port)` and the bundled child), **before** the global `express.json()`. Clients: `claude mcp add --transport http task-manager '<url>/mcp' --header 'Authorization: Bearer <key>' --scope local`, the line the UI's Connect a machine dialog prints (local scope lives in the user's `~/.claude.json`, wins over a committed `.mcp.json`, and keeps the key out of the repo — never `--scope project`).

- **Stateless on purpose**: no session map, a `pm2 restart` strands no client, and the tools send no server→client notifications.
- **Second store connection on purpose**: `PRAGMA data_version` only moves for writes from *other* connections, so the UI's 1 s poll pushes SSE for MCP writes with no extra wiring.
- Never calls `adoptDefaultProject` — one process serves many projects.
- **API keys (#362)**: `api_keys(id AUTOINCREMENT, label, project → projects, hash UNIQUE, created_at, last_used_at, revoked_at)`. Key = `stm_` + 32 random bytes base64url; only the SHA-256 is stored (a random 256-bit key needs no slow hash). `verifyApiKey` looks up by hash, `timingSafeEqual`s, skips revoked rows and returns `{ id, project }`. One key per repo: its `project` is the connection's default — a suggestion, not a boundary; tools still take `project`. NULL for keys from before migration `20261029120000`; those need `X-Project`. `last_used_at` is touched at most once a minute (spares the write lock and the UI's `data_version` poll), best-effort: a stale schema or busy DB never fails auth. Managed only in the UI (`/api/keys`, Connect a machine dialog in the footer); `listApiKeys` returns active keys only, rows never carry the hash, the plaintext key appears once in the POST response, nothing goes over SSE.

## Consumers of the `Store` surface

`tasks.ts` is the only source of the SQLite store. Two consumers:

- `mcp/*` — JSON-RPC tools registered onto the McpServer. Imports `createStore`, `Store`, and the typed inputs/outputs directly.
- `./task-manager-ui/src/server/taskStore.ts` — thin async wrapper used by the web UI. Imports `createStore`, `AddInput`, `UpdatePatch`, `LoadResult`, `Store` via `'../../../tasks.js'` (climbs out of `task-manager-ui/` to the parent package root).

When you add/rename/remove a method on `Store`, the UI wrapper in `task-manager-ui/src/server/taskStore.ts` may need a corresponding edit. There is no compile-time link between the two packages, so it pays to grep `task-manager-ui` for the old method name before declaring done.

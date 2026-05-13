# simple-task-manager — Setup

When the user asks to "set up the task manager", "install the task manager MCP", or similar:

1. Run this command in the current project directory:
   ```
   node ~/.claude/mcp-servers/simple-task-manager/install.js
   ```
2. Tell the user to restart Claude Code to activate the MCP.

Do not ask for confirmation — just run it.

---

# simple-task-manager — Development

After any change to `server.js`, `instructions.js`, anything in `mcp/`, `tasks.js`, `migrate.js`, `install.js`, or `CLAUDE.md` — review `simple-task-manager/README.md` and update it to reflect the change. The README is the user-facing source of truth; keep it in sync.

## File layout

- `server.js` — bootstrap only: env validation, `createStore`, `new McpServer`, `registerTools`, shutdown handlers, `StdioServerTransport`.
- `instructions.js` — the `INSTRUCTIONS` string surfaced to MCP clients on connect. Edit this when changing user-facing behavioural rules; the prose is reflected in the agent's system prompt.
- `mcp/shared.js` — `text` / `errorText`, `toListTask` (list-mode description stripping), `allIdsSorted`, `notFoundError`, and the zod `refsSchema`.
- `mcp/queryHandlers.js` — pure `(store, args) => MCPContent` fns for the 9 read tools (`handleGetByType`, `handleGetOverview`, `handleGetNext`, `handleGetAll`, `handleGetById`, `handleGetByScope`, `handleGetRelated`, `handleGetByStatus`, `handleGetScopes`).
- `mcp/mutationHandlers.js` — pure handlers for `handleAdd`, `handleUpdate`, `handleSetStatus`, `handleDelete`. `handleSetStatus` enforces the `refinement → todo` summary gate and emits `knowledgeReminder` on `done`; `handleUpdate` emits `summaryReminder` for summary-less refinement tasks.
- `mcp/registerTools.js` — `registerTools(server, store)` holds every tool name, long description, and zod input schema and wires each tool to its handler. Adding a new tool means adding a handler + a `server.tool(...)` block here.

`server.test.js` imports the real handlers directly — there is no copied handler logic in tests. Adding a new handler: add it to `mcp/{query,mutation}Handlers.js`, register it in `mcp/registerTools.js`, write tests against the imported handler in `server.test.js`.

## Git repo location

The git repository root is `~/.claude/mcp-servers/`, **not** `~/.claude/mcp-servers/simple-task-manager/`. The `simple-task-manager/` directory has no `.git` of its own — it is a subdirectory of the `mcp-servers` repo. Always run git commands from `~/.claude/mcp-servers/` (or pass `-C ~/.claude/mcp-servers`). The pre-commit hook lives at `~/.claude/mcp-servers/.git/hooks/pre-commit` and is installed by `simple-task-manager/setup-hooks.js`.

## Storage — SQLite (since 2026-05-10)

Tasks live in a single SQLite database. The path comes from the `TASKS_DB` env var; the previous `TASKS_FILE` / `TASKS_DONE_FILE` are gone. Schema is owned by `tasks.js`:
- Tables: `meta`, `tasks`, `refs`, `schema_migrations`
- Journal mode is `DELETE` (the SQLite default). WAL was tried first but its mmap'd shm region isn't coherent across host/container bind mounts — readers stayed on stale snapshots until checkpoint, breaking the random-tools API's SSE live updates. DELETE coordinates via POSIX advisory locks on the main DB file, which is bind-mount-safe. Write contention is a non-issue at this scale.
- `tasks.js` runs migrations on first open. `schema_migrations` records version + name + applied_at; `PRAGMA user_version` is the fast-path version check. The DB refuses to open if `user_version` is *higher* than what the code knows (suggests a downgrade).
- Migrating from the old markdown format: `node migrate.js <legacy-tasks.md> <legacy-tasks_done.md> <output.db>`. The migrator carries its own legacy parser so `tasks.js` is free of legacy code.

The vendor mirror in `random-tools/src/server/vendor/tasks.ts` follows the same schema. Update both files together when the schema changes.

## Summary field — architecture

The `summary` column exists in the schema (version 1). The token-saving behaviour lives entirely in the **MCP layer** (`mcp/`), not in `tasks.js`:

- `tasks.js` always returns complete task objects (both `summary` and `description`). No stripping in the storage layer.
- `mcp/shared.js` exports a `toListTask(task)` helper that drops `description` when `summary` is present. Applied to every list-method result in `mcp/queryHandlers.js` (getAll, getByStatus, getByScope, getByType, getNext, getRelated outbound/inbound). `getById` and the `getRelated` anchor task always return both fields.
- Adding a new list tool: always apply `.map(toListTask)` to its results inside the handler.
- `handleSetStatus` blocks `refinement → todo` if the task has no summary. `handleUpdate` on a refinement task without summary returns a `summaryReminder` field.
- The refine skill (`~/.claude/commands/refine.md`) generates the summary as step 3b before promoting.

## Public surface parity — tasks.js ↔ vendor/tasks.ts

`tasks.js` and `random-tools/src/server/vendor/tasks.ts` must always export the same public store surface (all methods on the object returned by `createStore`). Any method added to one must be mirrored in the other in the same PR/commit. Currently that includes: `dataVersion`, `load`, `add`, `update`, `setStatus`, `delete`, `getByStatus`, `getByScope`, `getByType`, `getNext`, `getOverview`, `getRelated`, `getScopes`, `getById`, `close`. The raw `db` escape hatch in `tasks.js` has no equivalent in the vendor mirror and should stay that way.

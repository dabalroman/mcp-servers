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

After any change to `server.js`, `tasks.js`, `migrate.js`, `install.js`, or `CLAUDE.md` — review `simple-task-manager/README.md` and update it to reflect the change. The README is the user-facing source of truth; keep it in sync.

## Git repo location

The git repository root is `~/.claude/mcp-servers/`, **not** `~/.claude/mcp-servers/simple-task-manager/`. The `simple-task-manager/` directory has no `.git` of its own — it is a subdirectory of the `mcp-servers` repo. Always run git commands from `~/.claude/mcp-servers/` (or pass `-C ~/.claude/mcp-servers`). The pre-commit hook lives at `~/.claude/mcp-servers/.git/hooks/pre-commit` and is installed by `simple-task-manager/setup-hooks.js`.

## Storage — SQLite (since 2026-05-10)

Tasks live in a single SQLite database. The path comes from the `TASKS_DB` env var; the previous `TASKS_FILE` / `TASKS_DONE_FILE` are gone. Schema is owned by `tasks.js`:
- Tables: `meta`, `tasks`, `refs`, `schema_migrations`
- Journal mode is `DELETE` (the SQLite default). WAL was tried first but its mmap'd shm region isn't coherent across host/container bind mounts — readers stayed on stale snapshots until checkpoint, breaking the random-tools API's SSE live updates. DELETE coordinates via POSIX advisory locks on the main DB file, which is bind-mount-safe. Write contention is a non-issue at this scale.
- `tasks.js` runs migrations on first open. `schema_migrations` records version + name + applied_at; `PRAGMA user_version` is the fast-path version check. The DB refuses to open if `user_version` is *higher* than what the code knows (suggests a downgrade).
- Migrating from the old markdown format: `node migrate.js <legacy-tasks.md> <legacy-tasks_done.md> <output.db>`. The migrator carries its own legacy parser so `tasks.js` is free of legacy code.

The vendor mirror in `random-tools/src/server/vendor/tasks.ts` follows the same schema. Update both files together when the schema changes.

## Public surface parity — tasks.js ↔ vendor/tasks.ts

`tasks.js` and `random-tools/src/server/vendor/tasks.ts` must always export the same public store surface (all methods on the object returned by `createStore`). Any method added to one must be mirrored in the other in the same PR/commit. Currently that includes: `dataVersion`, `load`, `add`, `update`, `setStatus`, `delete`, `getByStatus`, `getByScope`, `getByType`, `getNext`, `getOverview`, `getRelated`, `getScopes`, `getById`, `close`. The raw `db` escape hatch in `tasks.js` has no equivalent in the vendor mirror and should stay that way.

# Upgrading simple-task-manager

How to move a local clone to a newer version without losing data or quietly losing the skills and rules.

## Every upgrade

1. **Stop the server**, if you run one (`pm2 stop task-manager`). A running UI applies new migrations as soon as it restarts on the new code.
2. `git -C <dir> pull`
3. Run `npx tsx <dir>/simple-task-manager/install.ts` in each bound repo. It rebuilds `dist/`, which is what the MCP runs. An already-registered `.mcp.json` is left as it is.
4. Start the server again (`pm2 restart task-manager`), and restart every open Claude Code session. If the ecosystem file's env changed, add `--update-env` (see below).
5. Run the `health` tool. Every line should be ✓.

**Backups are automatic.** Whichever process applies a migration first (an MCP or a UI) copies the database next to itself as `<db>.backup-<YYYYMMDD-HHMMSS>-pre-<migration>` and logs the path to stderr. Backups are never deleted automatically. If you want an extra copy before pulling, run `sqlite3 <db> ".backup <db>.bak-<date>"`.

**Sessions on old code.** Once a newer build has migrated the database, an older process (from the version that added backups onward) refuses to write. Reads still work and carry a "rebuild and restart" warning. Restart the session, or `pm2 restart` the UI.

**Sessions on HTTP.** A session connected over `type: http` runs the UI process's code, so step 4's `pm2 restart` updates it; it doesn't need a session restart.

**pm2 keeps the old env.** `pm2 restart <name>` reuses the env from the first start, so a changed key in `ecosystem.task-ui.config.cjs` (e.g. `TASKS_DB`) is silently ignored. Use `pm2 restart <file> --update-env`, or `pm2 delete <name>` and `pm2 start <file>`.

## Version notes

### Two modes: bundled and client (2026-10-032)

- A stdio entry is always bundled. `TASK_UI_MODE=standalone` or `disabled` in an entry now makes the MCP **refuse to start**; it prints the fix on stderr (`node <dir>/simple-task-manager/dist/server.js` with that env shows it). Pick one:
  - **Client mode** (to share one DB/UI): delete the `task-manager` entry from `.mcp.json`, open the server's UI, click **Connect a machine** and run the line it prints in the repo.
  - **Bundled**: delete `TASK_UI_MODE` from the entry's env.
- `TASK_UI_MODE=bundled`, which older `install.ts` runs wrote, still works; `health` flags it ⚠ obsolete. Delete it when convenient.
- `setup-standalone.ts` is gone. The server is now `npx tsx <dir>/simple-task-manager/install.ts --server on|off` (run in the directory holding `ecosystem.task-ui.config.cjs`). It no longer edits `.mcp.json`.
- An existing ecosystem file keeps working. Re-running `--server on` there is optional; it regenerates the file without the obsolete `TASK_UI_MODE` key.

### API keys on /mcp (2026-10-031)

- `/mcp` now needs `Authorization: Bearer <key>` on every request, from the same machine too, and no longer checks the `Host` header. HTTP entries added before this get `401` until they send a key.
- Create one key per repo from **Connect a machine** in the UI (footer). In each repo run `claude mcp remove task-manager -s local`, then the dialog's `claude mcp add` line. The key carries the repo's default project, so the `X-Project` header is no longer needed.
- stdio entries (bundled mode) need no key and are unaffected. The migrations add an `api_keys` table; the pre-migration backup runs as usual.

### Shared standalone UI (2026-10-028)

- The standalone UI's pm2 app is now `task-manager` (`task-manager-<port>` on a non-default port), not the repo's `PROJECT_NAME`, and the UI no longer shows a project label: its tabs do that.
- Re-run `npx tsx <dir>/simple-task-manager/setup-standalone.ts on` once in the repo that holds `ecosystem.task-ui.config.cjs`. It replaces the old per-repo app with the new name.
- Other repos on the same DB can now run `setup-standalone.ts on` too: they join the UI already on the port instead of starting a second one.

### Projects (2026-10-025)

- Every task now belongs to a project. The first open files all existing tasks under `default`.
- While `default` is the only project, the first MCP start renames it to that repo's `PROJECT_NAME`. Single-repo installs need no setup.
- **Several repos on one DB:** the first MCP to start adopts `default` under its `PROJECT_NAME`. Create the other repos' projects with `createProject` (or `+ Project` in the UI), then move their tasks with `update({ id, project })`.
- Code from before this version can't add tasks to a migrated DB, so restart every session after the upgrade.

### Plugin (2026-10-021)

Skills and the full rules moved from `~/.claude/commands` and `SETUP.md` into a Claude Code plugin. After the steps above:

1. Install the plugin once per machine:
   ```sh
   claude plugin marketplace add dabalroman/mcp-servers
   claude plugin install task-manager@dabalroman --scope user
   ```
2. Delete `refine.md`, `implement.md`, `implement-as-coordinator.md` and `assess.md` from `~/.claude/commands/`. Left in place, they shadow the plugin's skills.
3. Remove the `@…/simple-task-manager/SETUP.md` line from `~/.claude/CLAUDE.md`. The file no longer exists, and Claude Code ignores a missing import without a warning.
4. `install.ts --global` is gone, and it now fails with a pointer to the plugin install.

`health` checks all three in its **Plugin** section.

## Rolling back

1. Stop the UIs and close the Claude sessions.
2. Restore the backup: copy `<db>.backup-…-pre-<migration>` over `<db>`.
3. `git -C <dir> checkout <old sha>`, then run `npm run build` in `simple-task-manager`.
4. If you go back before the plugin version, restore the old `~/.claude/commands` copies and disable the plugin (`claude plugin disable task-manager@dabalroman`).

## FAQ

**`/implement` behaves like an old version.** An old copy in `~/.claude/commands` shadows the plugin skill. Delete it, or call `/task-manager:implement`.

**The agent ignores the extended rules (epics, getNext order, prefixes).** The plugin's SessionStart hook only injects them when the session's project dir binds `task-manager`: in its `.mcp.json`, or in `~/.claude.json` at user or local scope. Launch Claude inside the bound repo, not from a parent folder.

**Do I have to re-run `install.ts` after every pull?** Yes. It rebuilds `dist/`, and without that the MCP keeps running old code.

**Who applies migrations?** The first process to open the database: any MCP or the standalone UI. That process also writes the automatic backup.

**Is the UI reachable from the network?** Yes. It listens on every interface with no authentication, so anyone on the same network can read the task text. Keep that in mind on shared networks.

**Why do `applied_at` and the task timestamps look an hour or two off?** They are stored in UTC without a zone marker.

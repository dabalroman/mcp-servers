# Upgrading simple-task-manager

How to move a local clone to a newer version without losing data or quietly losing the skills and rules.

## Every upgrade

1. **Stop the standalone UIs** (`pm2 stop <name>`). A running UI applies new migrations as soon as it restarts on the new code.
2. `git -C <dir> pull`
3. Run `npx tsx <dir>/simple-task-manager/install.ts` in each bound repo. It rebuilds `dist/`, which is what the MCP runs. An already-registered `.mcp.json` is left as it is.
4. Start the UIs again (`pm2 restart <name>`), and restart every open Claude Code session.
5. Run the `health` tool. Every line should be ✓.

**Backups are automatic.** Whichever process applies a migration first (an MCP or a UI) copies the database next to itself as `<db>.backup-<YYYYMMDD-HHMMSS>-pre-<migration>` and logs the path to stderr. Backups are never deleted automatically. If you want an extra copy before pulling, run `sqlite3 <db> ".backup <db>.bak-<date>"`.

**Sessions on old code.** Once a newer build has migrated the database, an older process (from the version that added backups onward) refuses to write. Reads still work and carry a "rebuild and restart" warning. Restart the session, or `pm2 restart` the UI.

## Version notes

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

# The `tm` plugin (`plugin/`)

Read before touching anything under `plugin/`, `bump-version.ts`, or the plugin version check in `health`.

- Layout: `.claude-plugin/plugin.json`, `skills/<name>/SKILL.md` (the 4 skills, single source), `hooks/hooks.json`, `hooks/session-rules.mjs`, `RULES.md`. The marketplace is `.claude-plugin/marketplace.json` at the repo root; `marketplace add owner/repo` reads only that path.
- `plugin/` must be self-contained: a git-marketplace install copies only that folder into the plugin cache. No `../` references, no symlinks out, no `CLAUDE.md` inside it (not loaded; validate warns).
- The plugin carries no MCP entry: project binding is per repo (`.mcp.json`) and plugin config (`pluginConfigs`) is user/managed-scope only; a plugin MCP would also connect in unbound repos.

## Versioning

- plugin.json `version` = `VERSION`, written by `bump-version.ts` on every commit (#367). A git install updates only when the version changes, so never hand-edit it or bump it selectively: a stale value pins every user. Every commit, not only `plugin/` changes, so plugin and server versions compare 1:1. The date format works as a plugin version (2.1.312: validates, and a bump is picked up by `claude plugin update`). A local-path marketplace loads in place regardless.
- `health` (stdio only) compares the installed plugin's recorded version with `VERSION`: ⚠ with the plugin-update command when older or sha-format, ⚠ with the server-update steps when newer; skipped for `directory` marketplaces (`known_marketplaces.json`), whose recorded version is frozen at install time.
- `package.json` versions (2.0.0, UI 1.0.0) are frozen on purpose: nothing is published to npm and nothing reads them. Don't sync them.
- Auto-update is off by default for third-party marketplaces; the README tells users how to enable it.

## SessionStart hook

Exec-form `node` + `args`, not a shell one-liner: shell-form hooks run in PowerShell on Windows when Git Bash is missing. The script is `.mjs` (not TS) because it runs unbuilt from the cache; it locates `RULES.md` via `$CLAUDE_PLUGIN_ROOT`, which changes on every plugin update — never cache it. It strips a UTF-8 BOM before parsing `.mcp.json` (Windows editors write one). The binding counts if `$CLAUDE_PROJECT_DIR/.mcp.json`, or `~/.claude.json` at user scope (top-level `mcpServers`) or local scope (`projects[<dir>].mcpServers`), has a `task-manager` entry. Each read fails to "not bound", and tests set `HOME` to a tmp dir.

## Skills

- Write the prefixed form (`/tm:implement`) in docs, rules, server instructions and the UI. Bare `/implement` resolves only when SKILL.md sets frontmatter `name` and no other command owns the name, and some sessions list only `tm:<skill>`, so a printed bare name can fail with "Unknown command" (#468). Keep `name:` on every skill anyway, so bare still works where it can. Skill-tool invocations inside skills use `tm:<skill>` (no slash). `/plan` is Claude Code's built-in plan mode, not ours: never prefix it.
- Skills are self-contained: an invocation loads only that skill, so never point at another skill's text unless the reader runs that skill (the coordinator's brief can cite `/tm:implement`'s OCR step because its subagent runs it). Shared text such as scope matching is restated in each skill (#476).
- The four skills (refine, implement, implement-as-coordinator, assess) stay separate skills.

## Dev

- Dev loop: `claude --plugin-dir <repo>/simple-task-manager/plugin`.
- User-facing hints are built from `PACKAGE_DIR` (`packageDir.ts`, works from source and `dist/`) — never hard-code the clone location.

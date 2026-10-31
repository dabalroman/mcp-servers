# `.mcp.json` env vars and health config checks

Read before adding or renaming an env var, or touching `mcpConfig.ts`, `install.ts` output, or `health`'s Config/Plugin sections. The current vars and their defaults are in `mcpConfig.ts` (`ENV_ORDER`, `ENV_DOCS`) and the README env-var table.

## Adding or renaming an env var

The MCP reads its config from `mcpServers["task-manager"].env` in the project's `.mcp.json`, written by `install.ts`. Update **all of these** in lockstep:

1. `mcpConfig.ts` — `ENV_DOCS` (printed by install.ts after writing `.mcp.json`) and `ENV_ORDER` (canonical position).
2. `install.ts` — the default value in the emitted `entry.env`.
3. The consumer (server.ts / mcp/* / task-manager-ui) — wherever the var is read.
4. `README.md` — the env-var table is the user-facing contract.
5. `mcpConfig.ts` — `LEGACY_ENV_KEYS` (rename hint) when renaming or retiring a var; `health` reads it to flag the old key as ✗ with the hint instead of letting it slide through as "unknown".

`PROJECT_NAME` is not used by the UI or the pm2 app name (#370); see `projects.md`.

## `.mcp.json` is strict JSON

Claude Code's project-level MCP loader (the one behind `/doctor`) rejects JSONC — a `//` comment makes it report "MCP config is not a valid JSON" and the MCP fails to load. `serializeMcpConfig` therefore writes pure JSON; env docs reach the user via `install.ts` printing `ENV_DOCS[key]` and the README table. Don't reintroduce comment emission, and don't add a `stripJsonComments` step to `parseMcpConfig` — both ends are pure JSON.

## `health`

- Config validates the `ENV_ORDER` vars from **`process.env`** (what the server actually received; user/local-scope bindings have no `.mcp.json`). A `.mcp.json` found above the cwd is scanned only for `LEGACY_ENV_KEYS` (✗) and ⚠ unknown keys, so health stays honest only while those two exports are current. A missing `.mcp.json` is not an error.
- Plugin reads `~/.claude/plugins/installed_plugins.json`, `settings.json` `enabledPlugins`, the old `~/.claude/commands/{refine,implement,implement-as-coordinator,assess}.md` copies (they shadow the plugin's bare skill names) and a dangling `@…/SETUP.md` import. The plugin version check is in `plugin.md`.
- `handleHealth(binding, { homeDir })` lets tests point it at a tmp home.

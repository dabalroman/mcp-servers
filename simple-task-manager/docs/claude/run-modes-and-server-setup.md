# Run modes and server setup

Read before touching `server.ts` startup/shutdown, `mcp/uiChild.ts`, `serverSetup.ts`, `/api/config`, or pm2 handling. Both modes are kept on purpose (#376).

## Two modes: bundled and client (#376)

- **bundled** — a stdio entry. `server.ts` always spawns the UI child; there is no mode switch.
- **client** — the repo's entry is `type: http` to **the server** (the pm2 app serving the UI + `/mcp`), added with the Connect a machine dialog's `claude mcp add … --scope local` line. `install.ts` never writes client entries.

**`TASK_UI_MODE` is retired** (it lives in `LEGACY_ENV_KEYS`). `server.ts` checks it before anything else: unset or `bundled` runs; any other value (`standalone`, `disabled`, garbage) writes the fix to **stderr** and `exit(1)`, because the JSON-RPC transport isn't up yet and silently running bundled would start an unwanted UI. `bundled` is tolerated because every pre-#376 `install.ts` wrote it; health shows it as ⚠ obsolete (and skips it in the `.mcp.json` legacy scan so it isn't also ✗). Old ecosystem files still carrying `TASK_UI_MODE: 'standalone'` work: the key is ignored.

**`ui-start` / `ui-stop`** are stdio-only (not registered over HTTP), so they have no mode branches. They stay as the manual restart for a crashed bundled UI.

**Mode is decided by the UI process, not config**: the bundled MCP passes `TASK_UI_BUNDLED=1` to its child; any UI without it (pm2, manual `npm start`) is the server. `task-manager-ui/server.ts` reports it as `mode` on `GET /api/config`; health's `ui` field is `bundled` over stdio and `TASK_UI_BUNDLED === '1' ? 'bundled' : 'server'` over HTTP (the handler runs in the UI process). `server` makes the not-reachable hint and the update steps mention `pm2 status|restart <pm2AppName(port)>`.

`/api/config` is auth-less and reachable by any LAN client. Keep its payload minimal — `{mode, version, packageDir, update}`. `packageDir` is the one deliberate path (#365: copyable commands in the mode/update dialogs; the same UI already serves task text containing host paths). Don't add other filesystem paths (e.g. `TASKS_DB`), credentials, or anything host-identifying; they'd leak the host's username + directory layout to anything that can reach the UI port.

## UI spawn (bundled mode)

`server.ts` spawns `./task-manager-ui/server.ts` after `createStore` returns; the UI dies with the MCP.

- `node --import tsx server.ts` with `cwd` = `task-manager-ui/`, so node resolves the `tsx` loader from that package's `node_modules`.
- `stdio: ['ignore', 'pipe', 'pipe']` — the child's stdout and stderr go to the MCP's **stderr**, because the MCP's own stdout is owned by JSON-RPC.
- The child gets the parent's full env plus `TASKS_DB` and `TASK_UI_BUNDLED=1`.
- A missing sibling (fresh checkout) logs a warning and the MCP continues without the UI.
- **Shutdown on stdin close**: Claude Code closes the stdio pipe without sending SIGTERM when its window closes, so `process.stdin` `'end'`/`'close'` run the same teardown as the signal handlers (kill UI, close store, exit) — otherwise the MCP and its UI child are orphaned on PID 1.

## Server setup — `install.ts --server on|off [dir] [--db <path>] [--port <n>]`

Logic in `serverSetup.ts`; never reads or writes `.mcp.json`.

- `on` — dir defaults to cwd, `--db` to `<dir>/tasks.db` (a given `--db` resolves against cwd), port to 7374. **Join**: if `dir` has no ecosystem file and `GET localhost:<port>/api/config` answers with a `mode`, it stops there. **Own**: otherwise it writes `<dir>/ecosystem.task-ui.config.cjs` (env: `TASKS_DB`, `TASK_UI_PORT` only), deletes `pm2AppName(port)` plus any legacy UI app on the port, then `pm2 start <file> && pm2 save`. install.ts rebuilds `dist/` first, as for bundled.
- `off` — only the owner (ecosystem file present) deletes the pm2 app(s) and the file; the port comes from the file unless `--port` is given.

**pm2 app name = `pm2AppName(port)`** follows the port, not `PROJECT_NAME` (#370): one server serves every project on its DB, and only one UI can bind a port. The UI mirrors it in `task-manager-ui/src/lib/pm2.ts` from `window.location.port` (the browser bundle can't import `mcpConfig.ts`). **Legacy apps** (pre-#370 per-repo names) are found via `pm2 jlist` by script path (`task-manager-ui/server.ts`) **and** `pm2_env.TASK_UI_PORT`, never by name, so an unrelated pm2 app that shares a project's name, or a UI on another port, is never deleted.

**pm2 restart keeps the old env**: after an env change in the ecosystem file, `pm2 restart <file> --update-env` (or delete + start). Re-running `--server on` already does delete + start.

**pm2 config-file detection** is filename-based: the file *must* match `*.config.{js,cjs}` for pm2 to read `apps[]`. Named `ecosystem.task-ui.cjs` (without `.config.`), pm2 treats it as a script — the process is named after the file, ignoring `apps[].name`. Don't drop the `.config.` segment.

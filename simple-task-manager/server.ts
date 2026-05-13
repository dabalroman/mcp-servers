import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { VERSION } from './version.js';
import { createStore } from './tasks.js';
import { INSTRUCTIONS } from './instructions.js';
import { registerTools } from './mcp/registerTools.js';

if (process.env.TASKS_FILE || process.env.TASKS_DONE_FILE) {
  process.stderr.write(
    '[simple-task-manager] WARNING: TASKS_FILE / TASKS_DONE_FILE are no longer used. ' +
    'Set TASKS_DB to the path of the SQLite database (e.g. /abs/path/tasks.db). ' +
    'Run `node migrate.js <legacy-tasks.md> <legacy-tasks_done.md> <output.db>` to migrate.\n'
  );
}

if (!process.env.TASKS_DB) {
  throw new Error(
    'TASKS_DB env var is required (path to the SQLite tasks database). ' +
    'See README for migration from the legacy markdown format.'
  );
}
const TASKS_DB = resolve(process.env.TASKS_DB);
const store = createStore(TASKS_DB);

const server = new McpServer(
  { name: 'simple-task-manager', version: VERSION },
  { instructions: INSTRUCTIONS }
);

registerTools(server, store);

// ── task-manager-ui spawn ────────────────────────────────────────────────────
//
// If the `task-manager-ui/` sub-package is present, spawn its server as a
// child process so Claude bringing up this MCP also brings up the web UI.
// Lives at simple-task-manager/task-manager-ui/server.ts; we run it via the
// local tsx loader (cwd = that package, so node resolves tsx from its
// node_modules).
//
// Env vars:
//   TASKS_DB           — forwarded so the UI opens the same database.
//   TASK_UI_PORT       — forwarded; default 7374.
//   AUTO_OPEN_TASK_UI  — forwarded; UI auto-opens the browser when "1".
//
// Disable spawn entirely with TASK_UI_DISABLE=1 (useful for tests or when
// running the UI manually from a separate terminal).
// This file may run from source (`simple-task-manager/server.ts`, one level
// from the package root) or from the compiled dist (`simple-task-manager/dist/server.js`,
// two levels in). Try both depths so the sibling lookup works in either case.
const here = dirname(fileURLToPath(import.meta.url));
const uiCandidates = [
  resolve(here, '../task-manager-ui'),
  resolve(here, '../../task-manager-ui'),
];
const uiPkgDir = uiCandidates.find((p) => existsSync(resolve(p, 'server.ts'))) ?? uiCandidates[0]!;
const uiServerEntry = resolve(uiPkgDir, 'server.ts');
let uiChild: ChildProcess | null = null;

if (process.env.TASK_UI_DISABLE === '1') {
  process.stderr.write('[simple-task-manager] task-manager-ui spawn disabled via TASK_UI_DISABLE=1\n');
} else if (!existsSync(uiServerEntry)) {
  process.stderr.write(`[simple-task-manager] task-manager-ui not found at ${uiPkgDir} — UI will not be available\n`);
} else {
  try {
    uiChild = spawn(process.execPath, ['--import', 'tsx', uiServerEntry], {
      cwd: uiPkgDir,
      env: { ...process.env, TASKS_DB },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    uiChild.stdout?.on('data', (b: Buffer) => { process.stderr.write(b); });
    uiChild.stderr?.on('data', (b: Buffer) => { process.stderr.write(b); });
    uiChild.on('exit', (code, signal) => {
      process.stderr.write(`[simple-task-manager] task-manager-ui exited (code=${code} signal=${signal})\n`);
      uiChild = null;
    });
  } catch (err) {
    process.stderr.write(`[simple-task-manager] failed to spawn task-manager-ui: ${String(err)}\n`);
    uiChild = null;
  }
}

function killUi() {
  if (uiChild && uiChild.pid && !uiChild.killed) {
    try { uiChild.kill('SIGTERM'); } catch { /* ignore */ }
  }
}

process.on('SIGINT',  () => { killUi(); try { store.close(); } catch { /* ignore */ } process.exit(0); });
process.on('SIGTERM', () => { killUi(); try { store.close(); } catch { /* ignore */ } process.exit(0); });
process.on('exit',    () => { killUi(); try { store.close(); } catch { /* ignore */ } });

const transport = new StdioServerTransport();
await server.connect(transport);

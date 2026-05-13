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

// Buffered log queue — anything emitted before the JSON-RPC transport is
// connected is held here and flushed once `server.connect()` resolves. All
// runtime messages (startup warnings, UI child stdout/stderr, spawn errors)
// go through this path so the MCP's own stderr stays empty — otherwise
// Claude Code surfaces it as a red "MCP error" indicator.
type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error';
const logQueue: Array<{ level: LogLevel; data: string }> = [];
let logFlushed = false;
function logToClient(level: LogLevel, data: string): void {
  const trimmed = data.replace(/\s+$/, '');
  if (!trimmed) return;
  if (!logFlushed) {
    logQueue.push({ level, data: trimmed });
    return;
  }
  void server.server.sendLoggingMessage({ level, data: trimmed }).catch(() => { /* ignore */ });
}

if (process.env.TASKS_FILE || process.env.TASKS_DONE_FILE) {
  logToClient(
    'warning',
    '[simple-task-manager] TASKS_FILE / TASKS_DONE_FILE are no longer used. ' +
    'Set TASKS_DB to the path of the SQLite database (e.g. /abs/path/tasks.db). ' +
    'Run `node migrate.js <legacy-tasks.md> <legacy-tasks_done.md> <output.db>` to migrate.'
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
  { instructions: INSTRUCTIONS, capabilities: { logging: {} } }
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

function pipeChildLines(
  stream: NodeJS.ReadableStream | null | undefined,
  level: LogLevel,
): void {
  if (!stream) return;
  let buf = '';
  stream.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8');
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.length) logToClient(level, line);
    }
  });
  stream.on('end', () => { if (buf.length) logToClient(level, buf); });
}

if (process.env.TASK_UI_DISABLE === '1') {
  logToClient('info', '[simple-task-manager] task-manager-ui spawn disabled via TASK_UI_DISABLE=1');
} else if (!existsSync(uiServerEntry)) {
  logToClient('warning', `[simple-task-manager] task-manager-ui not found at ${uiPkgDir} — UI will not be available`);
} else {
  try {
    uiChild = spawn(process.execPath, ['--import', 'tsx', uiServerEntry], {
      cwd: uiPkgDir,
      env: { ...process.env, TASKS_DB },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    pipeChildLines(uiChild.stdout, 'info');
    pipeChildLines(uiChild.stderr, 'warning');
    uiChild.on('exit', (code, signal) => {
      logToClient('warning', `[simple-task-manager] task-manager-ui exited (code=${code} signal=${signal})`);
      uiChild = null;
    });
  } catch (err) {
    logToClient('error', `[simple-task-manager] failed to spawn task-manager-ui: ${String(err)}`);
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

logFlushed = true;
for (const entry of logQueue.splice(0)) {
  void server.server.sendLoggingMessage(entry).catch(() => { /* ignore */ });
}

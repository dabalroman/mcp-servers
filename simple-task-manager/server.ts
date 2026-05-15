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

if (!process.env.TASKS_DB) {
  throw new Error('TASKS_DB env var is required (absolute path to the SQLite tasks database).');
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
// Env vars (forwarded via the `...process.env` spread to the child):
//   TASKS_DB                       — UI opens the same SQLite database.
//   PROJECT_NAME                   — UI header pill + browser tab title.
//   TASK_UI_PORT                   — port for the UI; default 7374.
//   TASK_UI_AUTO_OPEN_IN_BROWSER   — UI auto-opens the system browser when "1".
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
export const uiPkgDir = uiCandidates.find((p) => existsSync(resolve(p, 'server.ts'))) ?? uiCandidates[0]!;
export const uiServerEntry = resolve(uiPkgDir, 'server.ts');
export const resolvedTasksDb = TASKS_DB;
let uiChild: ChildProcess | null = null;

export function getUiChild(): ChildProcess | null { return uiChild; }
export function setUiChild(child: ChildProcess | null): void { uiChild = child; }

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

export function spawnUi(): void {
  if (!existsSync(uiServerEntry)) {
    logToClient('warning', `[simple-task-manager] task-manager-ui not found at ${uiPkgDir} — UI will not be available`);
    return;
  }
  try {
    const child = spawn(process.execPath, ['--import', 'tsx', uiServerEntry], {
      cwd: uiPkgDir,
      env: { ...process.env, TASKS_DB: resolvedTasksDb },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    pipeChildLines(child.stdout, 'info');
    pipeChildLines(child.stderr, 'warning');
    child.on('exit', (code, signal) => {
      logToClient('warning', `[simple-task-manager] task-manager-ui exited (code=${code} signal=${signal})`);
      uiChild = null;
    });
    uiChild = child;
  } catch (err) {
    logToClient('error', `[simple-task-manager] failed to spawn task-manager-ui: ${String(err)}`);
    uiChild = null;
  }
}

// TASK_UI_MODE is the single source of truth for whether/how the UI runs.
// Values: "bundled" (default) | "standalone" (pm2 owns it) | "disabled" (no UI).
// Missing or unrecognised values fall back to "bundled" so existing setups keep
// working until install/setup-standalone updates the file.
const uiMode = process.env.TASK_UI_MODE ?? 'bundled';
if (uiMode === 'standalone') {
  logToClient('info', '[simple-task-manager] TASK_UI_MODE=standalone — UI is pm2-managed, not spawning a child');
} else if (uiMode === 'disabled') {
  logToClient('info', '[simple-task-manager] TASK_UI_MODE=disabled — UI will not run');
} else {
  spawnUi();
}

function killUi() {
  if (uiChild && uiChild.pid && !uiChild.killed) {
    try { uiChild.kill('SIGTERM'); } catch { /* ignore */ }
  }
}

// Synchronous shutdown for OS signals — fast, no transport flushing needed.
function shutdown() { killUi(); try { store.close(); } catch { /* ignore */ } process.exit(0); }

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
process.on('exit',    () => { killUi(); try { store.close(); } catch { /* ignore */ } });

// Graceful stdin-EOF shutdown: close the JSON-RPC transport first so Claude
// Code sees a clean MCP disconnect rather than an abrupt process death.
// Without this, /mcp reconnect triggers "1 MCP server failed" because Claude
// Code closes the stdio pipe (causing stdin 'end') before spawning a fresh
// process, and our immediate process.exit(0) is recorded as a failure (#143).
let isShuttingDown = false;
async function stdinShutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  try { await server.close(); } catch { /* ignore */ }
  killUi();
  try { store.close(); } catch { /* ignore */ }
  process.exit(0);
}

process.stdin.on('end',   () => { void stdinShutdown(); });
process.stdin.on('close', () => { void stdinShutdown(); });

const transport = new StdioServerTransport();
await server.connect(transport);

logFlushed = true;
for (const entry of logQueue.splice(0)) {
  void server.server.sendLoggingMessage(entry).catch(() => { /* ignore */ });
}

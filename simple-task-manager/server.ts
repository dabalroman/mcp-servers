import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolve } from 'node:path';
import { VERSION } from './version.js';
import { createStore } from './tasks.js';
import { INSTRUCTIONS } from './instructions.js';
import { registerTools } from './mcp/registerTools.js';
import { uiPkgDir, initUiChild, spawnUi, getUiChild, setUiChild } from './mcp/uiChild.js';

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
const resolvedTasksDb = resolve(process.env.TASKS_DB);
const store = createStore(resolvedTasksDb);

const server = new McpServer(
  { name: 'simple-task-manager', version: VERSION },
  { instructions: INSTRUCTIONS, capabilities: { logging: {} } }
);

registerTools(server, store);

// ── task-manager-ui spawn ────────────────────────────────────────────────────
// UI child state and spawn logic live in mcp/uiChild.ts to break the circular
// dep: server.ts → registerTools → mutationHandlers → (was: dynamic server.ts).
// initUiChild wires in the DB path and log function before spawnUi() is called.
initUiChild(resolvedTasksDb, logToClient);

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
  // bundled mode: fail loudly if the UI sub-package is missing
  if (uiPkgDir === null) {
    throw new Error('[simple-task-manager] task-manager-ui not found at any expected location. Re-run the installer or set TASK_UI_MODE=disabled.');
  }
  spawnUi();
}

function killUi() {
  const child = getUiChild();
  if (child && child.pid && !child.killed) {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
  }
  setUiChild(null);
}

// Single shutdown path — all exit signals route here so killUi() and
// store.close() each run at most once. graceful=true closes the JSON-RPC
// transport first so Claude Code sees a clean MCP disconnect rather than an
// abrupt process death; without it, /mcp reconnect triggers "1 MCP server
// failed" because the stdio-EOF reaches us before the fresh process spawns
// (#143).
let isShuttingDown = false;
async function shutdown(graceful = false): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  if (graceful) try { await server.close(); } catch { /* ignore */ }
  killUi();
  try { store.close(); } catch { /* ignore */ }
  process.exit(0);
}

process.on('SIGINT',  () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
// 'exit' is a last-resort safety net; the handlers above already call process.exit(0)
// which fires this. Cannot be async — repeat sync cleanup only (killUi is sync).
process.on('exit',    () => { killUi(); try { store.close(); } catch { /* ignore */ } });

const transport = new StdioServerTransport();
await server.connect(transport);

// Stdin listeners are registered *after* server.connect() resolves so the
// StdioServerTransport owns stdin first. Attaching listeners before connect()
// can switch stdin to flowing mode and steal bytes intended for the transport.
process.stdin.on('end',   () => { void shutdown(true); });
process.stdin.on('close', () => { void shutdown(true); });

logFlushed = true;
for (const entry of logQueue.splice(0)) {
  void server.server.sendLoggingMessage(entry).catch(() => { /* ignore */ });
}

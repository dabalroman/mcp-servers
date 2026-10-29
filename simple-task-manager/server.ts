import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolve } from 'node:path';
import { VERSION } from './version.js';
import { createStore } from './tasks.js';
import { INSTRUCTIONS } from './instructions.js';
import { registerTools } from './mcp/registerTools.js';
import { uiPkgDir, initUiChild, spawnUi, getUiChild, setUiChild } from './mcp/uiChild.js';
import { checkForUpdate } from './updateCheck.js';
import { PACKAGE_DIR } from './packageDir.js';

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

// A stdio entry is always bundled (#376). The shared-DB modes it once had,
// standalone and disabled, are client mode now: refuse with the fix rather than
// run a mode the user didn't ask for. Stderr, because the transport isn't up.
const legacyUiMode = process.env.TASK_UI_MODE;
if (legacyUiMode && legacyUiMode !== 'bundled') {
  process.stderr.write([
    `[simple-task-manager] TASK_UI_MODE=${legacyUiMode} is no longer supported; a stdio entry always runs bundled.`,
    'To share one DB and server: delete the task-manager entry from .mcp.json, open the server\'s UI,',
    'click Connect a machine and run the line it prints in this repo (client mode).',
    `To start a server first: npx tsx ${resolve(PACKAGE_DIR, 'install.ts')} --server on`,
    'To keep a per-repo bundled setup: delete TASK_UI_MODE from the entry\'s env.',
    '',
  ].join('\n'));
  process.exit(1);
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

// PROJECT_NAME binds this connection to a project; list tools default to it.
const project = process.env.PROJECT_NAME?.trim() || 'default';
if (store.adoptDefaultProject(project)) {
  logToClient('info', `[simple-task-manager] Adopted the "default" project as "${project}"`);
}

registerTools(server, store, { project, transport: 'stdio' });

// ── task-manager-ui spawn ────────────────────────────────────────────────────
// UI child state and spawn logic live in mcp/uiChild.ts to break the circular
// dep: server.ts → registerTools → mutationHandlers → (was: dynamic server.ts).
// initUiChild wires in the DB path and log function before spawnUi() is called.
initUiChild(resolvedTasksDb, logToClient);

if (uiPkgDir === null) {
  throw new Error('[simple-task-manager] task-manager-ui not found at any expected location. Re-run the installer.');
}
spawnUi();

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

void checkForUpdate().then((result) => {
  if (result.state !== 'available') return;
  logToClient('info', `[simple-task-manager] Update available: v${result.remote} (local v${result.local}) — run: git -C ${PACKAGE_DIR} pull, then npx tsx ${resolve(PACKAGE_DIR, 'install.ts')} in this project, then restart Claude Code.`);
});

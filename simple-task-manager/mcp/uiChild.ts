import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error';
type LogFn = (level: LogLevel, data: string) => void;

const here = dirname(fileURLToPath(import.meta.url));
// server.ts may run from source (simple-task-manager/mcp/) or from compiled dist
// (simple-task-manager/dist/mcp/). Try both depths so the sibling lookup works.
const uiCandidates = [
  resolve(here, '../../task-manager-ui'),   // from mcp/ (dev)
  resolve(here, '../../../task-manager-ui'), // from dist/mcp/ (prod)
];

export const uiPkgDir: string | null =
  uiCandidates.find((p) => existsSync(resolve(p, 'server.ts'))) ?? null;
export const uiServerEntry: string | null = uiPkgDir ? resolve(uiPkgDir, 'server.ts') : null;

let uiChild: ChildProcess | null = null;
export function getUiChild(): ChildProcess | null { return uiChild; }
export function setUiChild(child: ChildProcess | null): void { uiChild = child; }

// Populated by initUiChild() at server startup before spawnUi() is called.
let _tasksDb = '';
let _log: LogFn = () => { /* no-op until init */ };

export function initUiChild(tasksDb: string, log: LogFn): void {
  _tasksDb = tasksDb;
  _log = log;
}

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
      if (line.length) _log(level, line);
    }
  });
  stream.on('end', () => { if (buf.length) _log(level, buf); });
}

export function spawnUi(): void {
  if (!uiServerEntry || !uiPkgDir) {
    _log('warning', `[simple-task-manager] task-manager-ui not found at any expected location — UI will not be available`);
    return;
  }
  try {
    const child = spawn(process.execPath, ['--import', 'tsx', uiServerEntry], {
      cwd: uiPkgDir,
      env: { ...process.env, TASKS_DB: _tasksDb },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    pipeChildLines(child.stdout, 'info');
    pipeChildLines(child.stderr, 'warning');
    child.on('exit', (code, signal) => {
      _log('warning', `[simple-task-manager] task-manager-ui exited (code=${code} signal=${signal})`);
      uiChild = null; // unconditional — prevents stale reference if exit fires after a crash
    });
    uiChild = child;
  } catch (err) {
    _log('error', `[simple-task-manager] failed to spawn task-manager-ui: ${String(err)}`);
    uiChild = null;
  }
}

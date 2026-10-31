import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PACKAGE_DIR } from '../packageDir.js';

type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error';
type LogFn = (level: LogLevel, data: string) => void;

// PACKAGE_DIR, not a path relative to this file: it differs between mcp/ (source) and dist/mcp/.
const uiDir = resolve(PACKAGE_DIR, 'task-manager-ui');
export const uiPkgDir: string | null = existsSync(resolve(uiDir, 'server.ts')) ? uiDir : null;
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
      // TASK_UI_BUNDLED tells the UI it is this MCP's child, not the server.
      env: { ...process.env, TASKS_DB: _tasksDb, TASK_UI_BUNDLED: '1' },
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

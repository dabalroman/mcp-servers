#!/usr/bin/env node
/**
 * setup-standalone.ts on|off — per-project toggle for pm2-managed standalone UI mode.
 *
 * Run from the project root (the directory containing `.mcp.json`):
 *
 *   npx tsx <dir>/simple-task-manager/setup-standalone.ts on
 *   npx tsx <dir>/simple-task-manager/setup-standalone.ts off
 *
 * One standalone UI serves every repo on the same DB and port, as the pm2 app
 * `task-manager` (`task-manager-<port>` on a non-default port).
 * The repo holding ecosystem.task-ui.config.cjs owns it; other repos join it.
 *
 * `on`  — sets TASK_UI_MODE=standalone in .mcp.json, ensures PROJECT_NAME / TASK_UI_PORT /
 *         TASKS_DB. If this repo doesn't own the UI and one already answers on the port,
 *         it joins that UI and stops there. Otherwise it writes the ecosystem file,
 *         replaces any old per-repo UI app and runs `pm2 start && pm2 save`.
 * `off` — sets TASK_UI_MODE=bundled. Only the owning repo also deletes the pm2 app
 *         and the ecosystem file; a joined repo leaves the shared UI running.
 *
 * After either command, restart Claude Code so the MCP picks up the new env block.
 *
 * The script reads/writes .mcp.json via the shared helpers in mcpConfig.ts so
 * env-var ordering stays diff-stable across edits.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMcpConfig, serializeMcpConfig, pm2AppName } from './mcpConfig.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_CWD = resolve(HERE, 'task-manager-ui');

const mode = process.argv[2];
if (mode !== 'on' && mode !== 'off') {
  console.error('Usage: setup-standalone.ts on|off  (run from the project directory)');
  process.exit(1);
}

const projectDir = process.cwd();
const mcpFile = resolve(projectDir, '.mcp.json');
const ecosystemFile = resolve(projectDir, 'ecosystem.task-ui.config.cjs');

if (!existsSync(mcpFile)) {
  console.error(`No .mcp.json in ${projectDir}. Run install.ts first to register the task-manager MCP.`);
  process.exit(1);
}

const config = (() => {
  try {
    return parseMcpConfig(readFileSync(mcpFile, 'utf8'));
  } catch (err) {
    console.error(`Failed to parse ${mcpFile}: ${(err as Error).message}`);
    process.exit(1);
  }
})();

const tmEntry = config.mcpServers?.['task-manager'];
if (!tmEntry) {
  console.error(`No "task-manager" entry in ${mcpFile}. Run install.ts first.`);
  process.exit(1);
}
tmEntry.env ??= {};
const env = tmEntry.env;

function writeMcp(): void {
  writeFileSync(mcpFile, serializeMcpConfig(config));
}

function pm2(args: string[], { ignoreFailure = false }: { ignoreFailure?: boolean } = {}): void {
  try {
    execFileSync('pm2', args, { stdio: 'inherit' });
  } catch (err) {
    if (!ignoreFailure) throw err;
  }
}

// UI apps on this port registered under older per-repo names (PROJECT_NAME). Matched
// by script path and port, never by name, so an unrelated pm2 app that shares a
// project's name survives, and so does a UI on another port.
function legacyUiApps(name: string, port: string): string[] {
  try {
    type App = { name: string; pm2_env?: { pm_exec_path?: string; TASK_UI_PORT?: string } };
    const apps = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' })) as App[];
    const script = resolve(UI_CWD, 'server.ts');
    return apps
      .filter((a) => a.name !== name && a.pm2_env?.pm_exec_path === script && (a.pm2_env.TASK_UI_PORT ?? '7374') === port)
      .map((a) => a.name);
  } catch {
    return [];
  }
}

async function uiAnswersOn(port: string): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/config`, { signal: AbortSignal.timeout(2000) });
    return res.ok && typeof ((await res.json()) as { mode?: unknown }).mode === 'string';
  } catch {
    return false;
  }
}

if (mode === 'on') {
  // Ensure standard params, then flip TASK_UI_MODE.
  const projectName = env['PROJECT_NAME'] || basename(projectDir);
  const port = env['TASK_UI_PORT'] || '7374';
  const tasksDb = env['TASKS_DB'] || resolve(projectDir, 'tasks.db');
  env['PROJECT_NAME'] = projectName;
  env['TASK_UI_PORT'] = port;
  env['TASKS_DB'] = tasksDb;
  env['TASK_UI_MODE'] = 'standalone';
  writeMcp();
  const appName = pm2AppName(port);

  if (!existsSync(ecosystemFile) && await uiAnswersOn(port)) {
    console.log(`\nA task-manager UI already answers on port ${port}; this repo now uses it.`);
    console.log(`It must serve the same database (${tasksDb}). Restart Claude Code to pick up the .mcp.json change.`);
    process.exit(0);
  }

  // Generate ecosystem file. Filename MUST include `.config.` — pm2 only treats
  // a file as an ecosystem config when its name matches that pattern; otherwise
  // it parses the file as a script and ignores apps[].name (process ends up
  // named after the file rather than apps[].name).
  const ecosystem = `// Generated by setup-standalone.ts — edit .mcp.json + re-run setup-standalone.ts to regenerate.
module.exports = {
  apps: [{
    name: ${JSON.stringify(appName)},
    script: 'server.ts',
    interpreter: 'node',
    interpreter_args: '--import tsx',
    cwd: ${JSON.stringify(UI_CWD)},
    env: {
      TASKS_DB: ${JSON.stringify(tasksDb)},
      TASK_UI_PORT: ${JSON.stringify(port)},
      // Tells the UI server it's running standalone so /api/config reports
      // "standalone" to the browser and the mode label is correct.
      TASK_UI_MODE: 'standalone',
    },
  }],
};
`;
  writeFileSync(ecosystemFile, ecosystem);

  // Ensure dist/ is built from current source before pm2 spawns it — a stale
  // dist/ would crash the MCP. Always rebuild; install deps first if missing.
  if (!existsSync(resolve(HERE, 'node_modules'))) {
    console.log('node_modules not found — running npm install...');
    execFileSync('npm', ['install'], { cwd: HERE, stdio: 'inherit', shell: process.platform === 'win32' });
  }
  console.log('Building dist/ from current source...');
  execFileSync('npm', ['run', 'build'], { cwd: HERE, stdio: 'inherit', shell: process.platform === 'win32' });

  // Replace the previous registration (and any old per-repo UI app), then start fresh.
  for (const name of [appName, ...legacyUiApps(appName, port)]) pm2(['delete', name], { ignoreFailure: true });
  pm2(['start', ecosystemFile]);
  pm2(['save']);

  console.log(`\nStandalone UI started as "${appName}" on port ${port}.`);
  console.log(`Restart Claude Code to pick up the .mcp.json change.`);
  process.exit(0);
}

// mode === 'off'
env['TASK_UI_MODE'] = 'bundled';
writeMcp();
const port = env['TASK_UI_PORT'] || '7374';
const appName = pm2AppName(port);

if (existsSync(ecosystemFile)) {
  for (const name of [appName, ...legacyUiApps(appName, port)]) pm2(['delete', name], { ignoreFailure: true });
  pm2(['save'], { ignoreFailure: true });
  unlinkSync(ecosystemFile);
  console.log(`\nStandalone UI removed. Restart Claude Code so the MCP resumes spawning the UI.`);
} else {
  console.log(`\nThis repo no longer uses the standalone UI; the shared "${appName}" app keeps running. Restart Claude Code to pick up the .mcp.json change.`);
}

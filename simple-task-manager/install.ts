#!/usr/bin/env node
/**
 * tsx install.ts [dir]   Per-project setup: writes .mcp.json in the project root (default: cwd).
 *                        If a stale task-manager entry pointing at server.ts/server.js exists,
 *                        it is rewritten to point at dist/server.js.
 * Skills and the extended rules ship separately, as the `task-manager` Claude Code plugin.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';
import { execFileSync } from 'node:child_process';
import { ENV_DOCS, ENV_ORDER, INSTALL_USAGE, isStaleEntry, parseInstallArgs, parseMcpConfig, serializeMcpConfig, type McpConfig, type McpEntry } from './mcpConfig.js';
import { PACKAGE_DIR } from './packageDir.js';

const serverEntry = resolve(PACKAGE_DIR, 'dist/server.js');

const args = parseInstallArgs(process.argv.slice(2));
if ('error' in args) {
  console.error(`Error: ${args.error}`);
  console.error(INSTALL_USAGE);
  process.exit(1);
}

// ── Ensure dist/ is built from current source before pointing .mcp.json at it ──
// .mcp.json points at dist/server.js; a stale dist/ (e.g. after a code pull that
// added migrations) crashes the MCP on startup. Always rebuild — the build is
// fast. node_modules may be absent on a fresh checkout — install first if so.
if (!existsSync(resolve(PACKAGE_DIR, 'node_modules'))) {
  console.log('node_modules not found — running npm install...');
  execFileSync('npm', ['install'], { cwd: PACKAGE_DIR, stdio: 'inherit', shell: process.platform === 'win32' });
}
console.log('Building dist/ from current source...');
execFileSync('npm', ['run', 'build'], { cwd: PACKAGE_DIR, stdio: 'inherit', shell: process.platform === 'win32' });
console.log('Rebuilt dist/ from current source.');

// ── per-project: write .mcp.json ───────────────────────────────────────────────
const projectDir = resolve(args.projectDir ?? process.cwd());
const mcpFile = resolve(projectDir, '.mcp.json');

const entry: McpEntry = {
  command: 'node',
  args: [serverEntry],
  env: {
    TASKS_DB: resolve(projectDir, 'tasks.db'),
    PROJECT_NAME: basename(projectDir),
    TASK_UI_PORT: '7374',
    TASK_UI_MODE: 'bundled',
    TASK_UI_AUTO_OPEN_IN_BROWSER: '0',
  },
};

let config: McpConfig = { mcpServers: {} };
if (existsSync(mcpFile)) {
  try {
    config = parseMcpConfig(readFileSync(mcpFile, 'utf8'));
    config.mcpServers ??= {};
  } catch {
    console.error(`Error: ${mcpFile} exists but is not valid JSON. Fix it manually first.`);
    process.exit(1);
  }
}

const existingEntry = config.mcpServers['task-manager'];

if (existingEntry && !isStaleEntry(existingEntry)) {
  console.log(`task-manager is already registered in ${mcpFile} — .mcp.json left unchanged (dist/ was rebuilt above).`);
} else {
  const action = existingEntry ? 'Refreshed' : 'Registered';
  config.mcpServers['task-manager'] = entry;
  writeFileSync(mcpFile, serializeMcpConfig(config));
  console.log(`${action} task-manager in ${mcpFile}`);
  console.log(`  server : ${entry.args[0]}`);
  console.log(`  db     : ${entry.env?.TASKS_DB ?? '(unset)'}`);

  // Print env-var docs so the user can see what each value means without
  // hunting through the README. We can't put these in `.mcp.json` itself —
  // Claude Code's MCP loader rejects JSONC comments.
  console.log('');
  console.log('Configured env vars (edit .mcp.json to change):');
  for (const key of ENV_ORDER) {
    const value = entry.env?.[key];
    if (value === undefined) continue;
    console.log(`  ${key} = ${JSON.stringify(value)}`);
    for (const line of ENV_DOCS[key] ?? []) {
      console.log(`    ${line}`);
    }
  }
  console.log('');
}

console.log('Restart open Claude sessions and any standalone UI (pm2 restart <name>) so they run the new build.');
console.log(`Skills and extended rules: /plugin marketplace add dabalroman/mcp-servers, then /plugin install task-manager@dabalroman`);

#!/usr/bin/env node
/**
 * Two modes:
 *   tsx install.ts --global   One-time setup: teaches Claude how to set up this MCP in any project.
 *   tsx install.ts [dir]      Per-project setup: writes .mcp.json in the project root (default: cwd).
 *                             If a stale task-manager entry pointing at server.ts/server.js exists,
 *                             it is rewritten to point at dist/server.js.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { ENV_DOCS, ENV_ORDER, parseMcpConfig, serializeMcpConfig, type McpConfig, type McpEntry } from './mcpConfig.js';

const serverDir = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(serverDir, 'dist/server.js');

// ── --global: register the setup instructions in ~/.claude/CLAUDE.md ──────────
if (process.argv[2] === '--global') {
  const claudeMd = resolve(homedir(), '.claude', 'CLAUDE.md');
  const marker = 'simple-task-manager/CLAUDE.md';
  const line = `@${resolve(serverDir, 'CLAUDE.md')}`;

  if (existsSync(claudeMd) && readFileSync(claudeMd, 'utf8').includes(marker)) {
    console.log(`simple-task-manager already registered in ${claudeMd} — nothing to do.`);
    process.exit(0);
  }

  const existing = existsSync(claudeMd) ? readFileSync(claudeMd, 'utf8') : '';
  const separator = existing.length && !existing.endsWith('\n') ? '\n' : '';
  mkdirSync(dirname(claudeMd), { recursive: true });
  writeFileSync(claudeMd, existing + separator + line + '\n');
  console.log(`Registered in ${claudeMd}`);
  console.log(`Claude can now set up this MCP in any project.`);
  console.log(`Start a new session and say: "setup the task manager"`);
  process.exit(0);
}

// ── per-project: write .mcp.json ───────────────────────────────────────────────
const projectDir = resolve(process.argv[2] ?? process.cwd());
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

// Detect a stale entry from the pre-TypeScript layout (args pointed at server.js
// at the package root). Rewrite it to the new dist/server.js path so existing
// installations keep working after upgrade.
function isStaleEntry(e: McpEntry | undefined): boolean {
  if (!e) return false;
  const arg0 = e.args?.[0] ?? '';
  return arg0.endsWith('/server.js') || arg0.endsWith('/server.ts');
}

if (existingEntry && !isStaleEntry(existingEntry)) {
  console.log(`task-manager is already registered in ${mcpFile} — nothing to do.`);
  process.exit(0);
}

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

// ── install skills ─────────────────────────────────────────────────────────────
const commandsDir = resolve(homedir(), '.claude', 'commands');
mkdirSync(commandsDir, { recursive: true });
for (const skill of ['refine', 'implement']) {
  const src = resolve(serverDir, 'commands', `${skill}.md`);
  const dest = resolve(commandsDir, `${skill}.md`);
  copyFileSync(src, dest);
  console.log(`  skill  : /${skill} → ${dest}`);
}

console.log(`Restart Claude Code to activate.`);

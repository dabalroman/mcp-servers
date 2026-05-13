#!/usr/bin/env node
/**
 * Two modes:
 *   tsx install.ts --global   One-time setup: teaches Claude how to set up this MCP in any project.
 *   tsx install.ts [dir]      Per-project setup: writes .mcp.json in the project root (default: cwd).
 *                             If a stale task-manager entry pointing at server.ts/server.js exists,
 *                             it is rewritten to point at dist/server.js.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const serverDir = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(serverDir, 'dist/server.js');

type McpEntry = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

type McpConfig = {
  mcpServers: Record<string, McpEntry>;
};

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
  },
};

let config: McpConfig = { mcpServers: {} };
if (existsSync(mcpFile)) {
  try {
    config = JSON.parse(readFileSync(mcpFile, 'utf8')) as McpConfig;
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
writeFileSync(mcpFile, JSON.stringify(config, null, 2) + '\n');
console.log(`${action} task-manager in ${mcpFile}`);
console.log(`  server : ${entry.args[0]}`);
console.log(`  db     : ${entry.env?.TASKS_DB ?? '(unset)'}`);
console.log(`Restart Claude Code to activate.`);

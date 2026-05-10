#!/usr/bin/env node
/**
 * Two modes:
 *   node install.js --global   One-time setup: teaches Claude how to set up this MCP in any project.
 *   node install.js [dir]      Per-project setup: writes .mcp.json in the project root (default: cwd).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const serverDir = dirname(fileURLToPath(import.meta.url));

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

const entry = {
  command: 'node',
  args: [resolve(serverDir, 'server.js')],
  env: {
    TASKS_DB: resolve(projectDir, 'tasks.db'),
  },
};

let config = { mcpServers: {} };
if (existsSync(mcpFile)) {
  try {
    config = JSON.parse(readFileSync(mcpFile, 'utf8'));
    config.mcpServers ??= {};
  } catch {
    console.error(`Error: ${mcpFile} exists but is not valid JSON. Fix it manually first.`);
    process.exit(1);
  }
}

if (config.mcpServers['task-manager']) {
  console.log(`task-manager is already registered in ${mcpFile} — nothing to do.`);
  process.exit(0);
}

config.mcpServers['task-manager'] = entry;
writeFileSync(mcpFile, JSON.stringify(config, null, 2) + '\n');
console.log(`Registered task-manager in ${mcpFile}`);
console.log(`  server : ${entry.args[0]}`);
console.log(`  db     : ${entry.env.TASKS_DB}`);
console.log(`Restart Claude Code to activate.`);

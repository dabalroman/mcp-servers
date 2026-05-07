#!/usr/bin/env node
/**
 * Registers simple-task-manager in a project by writing .mcp.json.
 * Run from the project root: node /path/to/simple-task-manager/install.js
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const serverDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(process.argv[2] ?? process.cwd());
const mcpFile = resolve(projectDir, '.mcp.json');

const entry = {
  command: 'node',
  args: [resolve(serverDir, 'server.js')],
  env: {
    TASKS_FILE: resolve(projectDir, 'TASKS.md'),
    TASKS_DONE_FILE: resolve(projectDir, 'TASKS_DONE.md'),
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
console.log(`  tasks  : ${entry.env.TASKS_FILE}`);
console.log(`Restart Claude Code to activate.`);

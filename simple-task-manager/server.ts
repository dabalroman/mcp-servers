import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolve } from 'node:path';
import { VERSION } from './version.js';
import { createStore } from './tasks.js';
import { INSTRUCTIONS } from './instructions.js';
import { registerTools } from './mcp/registerTools.js';

if (process.env.TASKS_FILE || process.env.TASKS_DONE_FILE) {
  process.stderr.write(
    '[simple-task-manager] WARNING: TASKS_FILE / TASKS_DONE_FILE are no longer used. ' +
    'Set TASKS_DB to the path of the SQLite database (e.g. /abs/path/tasks.db). ' +
    'Run `node migrate.js <legacy-tasks.md> <legacy-tasks_done.md> <output.db>` to migrate.\n'
  );
}

if (!process.env.TASKS_DB) {
  throw new Error(
    'TASKS_DB env var is required (path to the SQLite tasks database). ' +
    'See README for migration from the legacy markdown format.'
  );
}
const TASKS_DB = resolve(process.env.TASKS_DB);
const store = createStore(TASKS_DB);

const server = new McpServer(
  { name: 'simple-task-manager', version: VERSION },
  { instructions: INSTRUCTIONS }
);

registerTools(server, store);

process.on('SIGINT',  () => { try { store.close(); } catch { /* ignore */ } process.exit(0); });
process.on('SIGTERM', () => { try { store.close(); } catch { /* ignore */ } process.exit(0); });
process.on('exit',    () => { try { store.close(); } catch { /* ignore */ } });

const transport = new StdioServerTransport();
await server.connect(transport);

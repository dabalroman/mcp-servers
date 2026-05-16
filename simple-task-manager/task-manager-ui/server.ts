import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mountTaskApi } from './src/server/taskRouter.js';
import { VERSION } from '../version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, 'dist');

const port = parseInt(process.env.TASK_UI_PORT ?? '7374', 10);
const TASKS_DB = process.env.TASKS_DB
  ? path.resolve(process.env.TASKS_DB)
  : path.join(process.cwd(), 'tasks.db');
// Validate TASK_UI_MODE so the client gets a clean three-state value.
const RAW_MODE = process.env.TASK_UI_MODE ?? 'bundled';
const TASK_UI_MODE: 'bundled' | 'standalone' | 'disabled' =
  RAW_MODE === 'standalone' ? 'standalone' :
  RAW_MODE === 'disabled' ? 'disabled' :
  'bundled';
const PROJECT_NAME = process.env.PROJECT_NAME ?? null;

const app = express();
app.use(express.json());

const { dispose } = mountTaskApi(app, { dbPath: TASKS_DB });
process.once('SIGTERM', () => { try { dispose(); } catch { /* ignore */ } process.exit(0); });
process.once('SIGINT',  () => { try { dispose(); } catch { /* ignore */ } process.exit(0); });

// Surface a few server-side env values to the client. The static dist HTML is
// built once and served as-is; this endpoint is how the SPA learns the project
// name and the current run mode so it can render the header pill + mode label.
app.get('/api/config', (_req, res) => {
  res.json({ name: PROJECT_NAME, mode: TASK_UI_MODE, version: VERSION, tasksDb: TASKS_DB });
});

app.use(express.static(dist, { index: 'index.html', maxAge: '1h' }));

// SPA fallback so deep links resolve to index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).end();
  res.sendFile(path.join(dist, 'index.html'));
});

const server = app.listen(port, () => {
  const url = `http://localhost:${port}`;
  // The MCP parent pipes our stdout/stderr separately (its own JSON-RPC
  // stdout is on a different fd) and forwards each line as an MCP logging
  // notification — stdout = info, stderr = warning. So use stdout for the
  // normal "listening" line; reserve stderr for real errors.
  process.stdout.write(`[task-manager-ui] listening on ${url} (db: ${TASKS_DB})\n`);
  if (process.env.TASK_UI_AUTO_OPEN_IN_BROWSER === '1') {
    openBrowser(url);
  }
});

function openBrowser(url: string) {
  const opener =
    process.platform === 'darwin' ? 'open' :
    process.platform === 'win32'  ? 'start' :
                                    'xdg-open';
  import('node:child_process').then(({ spawn }) => {
    try {
      spawn(opener, [url], { stdio: 'ignore', detached: true }).unref();
    } catch {
      process.stderr.write(`[task-manager-ui] could not open browser via ${opener}\n`);
    }
  });
}

// Graceful close on unhandled rejection (don't crash the MCP)
process.on('unhandledRejection', (err) => {
  process.stderr.write(`[task-manager-ui] unhandledRejection: ${String(err)}\n`);
});

export { app, server };

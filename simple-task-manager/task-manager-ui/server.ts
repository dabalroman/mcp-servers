import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mountTaskApi } from './src/server/taskRouter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, 'dist');

const port = parseInt(process.env.TASK_UI_PORT ?? '7374', 10);
const TASKS_DB = process.env.TASKS_DB
  ? path.resolve(process.env.TASKS_DB)
  : path.join(process.cwd(), 'tasks.db');

const app = express();
app.use(express.json());

const { dispose } = mountTaskApi(app, { dbPath: TASKS_DB });
process.once('SIGTERM', () => { try { dispose(); } catch { /* ignore */ } process.exit(0); });
process.once('SIGINT',  () => { try { dispose(); } catch { /* ignore */ } process.exit(0); });

app.use(express.static(dist, { index: 'index.html', maxAge: '1h' }));

// SPA fallback so deep links resolve to index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).end();
  res.sendFile(path.join(dist, 'index.html'));
});

const server = app.listen(port, () => {
  const url = `http://localhost:${port}`;
  // Logs go to stderr — when spawned by the MCP, stdout is reserved for JSON-RPC.
  process.stderr.write(`[task-manager-ui] listening on ${url} (db: ${TASKS_DB})\n`);
  if (process.env.AUTO_OPEN_TASK_UI === '1') {
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

// connect/express-compatible middleware router for the /api/tasks surface.
// Works as a Vite configureServer middleware and as an Express sub-app.
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskApi, type TaskApi } from './taskApi.js';
import { isValidationError } from './taskStore.js';

type Next = (err?: unknown) => void;
type Handler = (req: IncomingMessage & { body?: unknown }, res: ServerResponse, next?: Next) => void;
export type MiddlewareStack = { use: (path: string, handler: Handler) => void };

export type MountOptions = { dbPath?: string };

export function mountTaskApi(middlewareStack: MiddlewareStack, opts: MountOptions = {}): { dispose: () => void } {
  const dbPath = opts.dbPath ?? resolveDefaultDbPath();
  const api = createTaskApi({ dbPath });

  const handle: Handler = (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    // SSE stream — must come before the JSON body check
    if (method === 'GET' && pathname === '/stream') {
      return api.stream(req, res);
    }

    if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
      if (req.body !== undefined) return dispatch(req, res, next, pathname, method, api);

      let raw = '';
      req.on('data', (c: Buffer | string) => { raw += c; });
      req.on('end', () => {
        try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
        void dispatch(req, res, next, pathname, method, api);
      });
      return;
    }

    void dispatch(req, res, next, pathname, method, api);
  };

  middlewareStack.use('/api/tasks', handle);
  return { dispose: () => api.dispose() };
}

async function dispatch(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
  next: Next | undefined,
  pathname: string,
  method: string,
  api: TaskApi,
): Promise<void> {
  const idMatch = pathname.match(/^\/(\d+)$/);
  const id = idMatch ? parseInt(idMatch[1]!, 10) : null;

  try {
    let result: unknown;

    if (method === 'GET' && pathname === '/') {
      result = api.list();
    } else if (method === 'POST' && pathname === '/') {
      result = await api.add(req.body as Parameters<TaskApi['add']>[0]);
    } else if (method === 'PATCH' && id !== null) {
      result = await api.patch(id, req.body as Parameters<TaskApi['patch']>[1]);
    } else if (method === 'DELETE' && id !== null) {
      result = await api.remove(id);
    } else {
      if (next) return next();
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    const body = JSON.stringify(result);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  } catch (err: unknown) {
    const e = err as Error;
    console.error('[task-api]', e);
    res.statusCode = isValidationError(err) ? 400 : 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: e.message }));
  }
}

function resolveDefaultDbPath(): string {
  if (process.env.TASKS_DB) return path.resolve(process.env.TASKS_DB);
  // Fall back to the cwd of the process — matches MCP behaviour.
  return path.resolve(process.cwd(), 'tasks.db');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Re-export so server.ts can find the static-assets directory.
export const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createTaskStore, type AddInput, type UpdatePatch } from './taskStore.js';
import type { TaskStatus } from '@/types/task';

export type TaskApiOptions = { dbPath: string };

export function createTaskApi({ dbPath }: TaskApiOptions) {
  const store = createTaskStore({ dbPath });
  const watchers = new Set<ServerResponse>();

  function broadcast() {
    for (const res of watchers) {
      try { res.write('event: tasks-changed\ndata: {}\n\n'); } catch { /* client gone */ }
    }
  }

  // Poll for external writes (e.g. MCP using a separate DB connection).
  // data_version only increments for *other* connections, so self-writes are
  // handled by calling broadcast() directly after each mutating operation.
  let lastDataVersion = store.dataVersion();
  const pollTimer = setInterval(() => {
    let v: number;
    try { v = store.dataVersion(); }
    catch { return; /* db closed */ }
    if (v !== lastDataVersion) {
      lastDataVersion = v;
      broadcast();
    }
  }, 1_000);
  if (typeof pollTimer.unref === 'function') pollTimer.unref();

  // Keep SSE connections alive through idle-timeout proxies.
  const heartbeatTimer = setInterval(() => {
    for (const res of watchers) {
      try { res.write(': ping\n\n'); } catch { /* client gone */ }
    }
  }, 20_000);
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();

  return {
    list() {
      return store.load();
    },

    async add(body: AddInput) {
      const id = await store.add(body);
      broadcast();
      return { id };
    },

    async patch(id: number, body: UpdatePatch & { status?: TaskStatus }) {
      const { status, ...fields } = body;
      let ok = true;
      if (status !== undefined) ok = (await store.setStatus(id, status)) && ok;
      if (Object.keys(fields).length > 0) ok = (await store.updateTask(id, fields)) && ok;
      broadcast();
      return { ok };
    },

    async remove(id: number) {
      const ok = await store.deleteTask(id);
      broadcast();
      return { ok };
    },

    stream(req: IncomingMessage, res: ServerResponse) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      res.write('event: connected\ndata: {}\n\n');

      watchers.add(res);
      const cleanup = () => watchers.delete(res);
      req.on('close', cleanup);
      req.on('error', cleanup);
      res.on('error', cleanup);
    },

    dispose() {
      clearInterval(pollTimer);
      clearInterval(heartbeatTimer);
      for (const res of watchers) {
        try { res.end(); } catch { /* already closed */ }
      }
      watchers.clear();
      store.close();
    },
  };
}

export type TaskApi = ReturnType<typeof createTaskApi>;

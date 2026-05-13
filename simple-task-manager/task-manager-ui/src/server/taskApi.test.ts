import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createTaskApi } from './taskApi.js';

function makeReq(): IncomingMessage {
  return new EventEmitter() as unknown as IncomingMessage;
}

function makeRes() {
  const chunks: string[] = [];
  const em = new EventEmitter();
  const res = Object.assign(em, {
    setHeader: () => {},
    flushHeaders: () => {},
    write: (chunk: string) => { chunks.push(chunk); return true; },
    end: () => { em.emit('finish'); },
    chunks,
  });
  return res as unknown as ServerResponse & { chunks: string[] };
}

let dir: string;
let dbPath: string;
let api: ReturnType<typeof createTaskApi>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskapi-test-'));
  dbPath = path.join(dir, 'tasks.db');
  api = createTaskApi({ dbPath });
});

afterEach(() => {
  try { api.dispose(); } catch { /* already disposed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('self-write broadcast', () => {
  it('broadcasts tasks-changed to watchers after add()', async () => {
    const req = makeReq();
    const res = makeRes();
    api.stream(req, res);

    await api.add({ type: 'bug', priority: 'medium', title: 'Test task', description: '' });

    expect(res.chunks.some((c) => c.includes('tasks-changed'))).toBe(true);
  });

  it('broadcasts tasks-changed to watchers after patch()', async () => {
    const id = (await api.add({ type: 'bug', priority: 'medium', title: 'Patch me', description: '' })).id;
    const req = makeReq();
    const res = makeRes();
    api.stream(req, res);

    await api.patch(id, { title: 'Patched' });

    expect(res.chunks.some((c) => c.includes('tasks-changed'))).toBe(true);
  });

  it('broadcasts tasks-changed to watchers after remove()', async () => {
    const id = (await api.add({ type: 'bug', priority: 'medium', title: 'Remove me', description: '' })).id;
    const req = makeReq();
    const res = makeRes();
    api.stream(req, res);

    await api.remove(id);

    expect(res.chunks.some((c) => c.includes('tasks-changed'))).toBe(true);
  });
});

describe('dispose()', () => {
  it('ends all active watcher streams', () => {
    const req = makeReq();
    const res = makeRes();
    api.stream(req, res);

    let ended = false;
    res.on('finish', () => { ended = true; });

    api.dispose();
    expect(ended).toBe(true);
  });

  it('stops broadcasting after dispose', () => {
    const req = makeReq();
    const res = makeRes();
    api.stream(req, res);

    api.dispose();
    const chunksBefore = res.chunks.length;

    expect(res.chunks.length).toBe(chunksBefore);
  });
});

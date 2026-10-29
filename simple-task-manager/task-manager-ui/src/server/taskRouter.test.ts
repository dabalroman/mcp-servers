import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { mountTaskApi } from './taskRouter.js';
import { createStore } from '../../../tasks.js';

let dir: string;
let dbPath: string;
let app: express.Express;
let disposeApi: () => void;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskrouter-test-'));
  dbPath = path.join(dir, 'tasks.db');
  app = express();
  app.use(express.json());
  ({ dispose: disposeApi } = mountTaskApi(app, { dbPath }));
});

afterEach(() => {
  try { disposeApi(); } catch { /* already disposed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/tasks — validation error', () => {
  it('returns 400 with Content-Type: application/json for empty title', async () => {
    const res = await request(app)
      .post('/api/tasks/')
      .send({ type: 'bug', priority: 'high', title: '   ' });
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toHaveProperty('error');
    expect(typeof res.body.error).toBe('string');
  });

  it('error message mentions title', async () => {
    const res = await request(app)
      .post('/api/tasks/')
      .send({ type: 'bug', priority: 'high', title: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });
});

describe('POST /api/tasks — success', () => {
  it('returns 200 with Content-Type: application/json and an id', async () => {
    const res = await request(app)
      .post('/api/tasks/')
      .send({ project: 'default', type: 'bug', priority: 'high', title: 'Valid task' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toHaveProperty('id');
  });
});

describe('GET /api/tasks — success', () => {
  it('returns 200 with Content-Type: application/json', async () => {
    const res = await request(app).get('/api/tasks/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

describe('POST /api/tasks — project', () => {
  it('returns 400 when project is missing or unknown', async () => {
    const missing = await request(app).post('/api/tasks/').send({ type: 'bug', priority: 'high', title: 'T' });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/project is required/);
    const unknown = await request(app).post('/api/tasks/').send({ project: 'nope', type: 'bug', priority: 'high', title: 'T' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatch(/project "nope" does not exist/);
  });
});

describe('/api/projects', () => {
  it('GET lists projects with counts', async () => {
    await request(app).post('/api/tasks/').send({ project: 'default', type: 'bug', priority: 'high', title: 'T' });
    const res = await request(app).get('/api/projects/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ name: 'default', total: 1, open: 1 }]);
  });

  it('POST creates a project; a case-insensitive duplicate or empty name is a 400', async () => {
    const created = await request(app).post('/api/projects/').send({ name: 'example-project' });
    expect(created.status).toBe(200);
    expect(created.body).toEqual({ name: 'example-project' });
    expect((await request(app).post('/api/projects/').send({ name: 'Example-Project' })).status).toBe(400);
    expect((await request(app).post('/api/projects/').send({ name: ' ' })).status).toBe(400);
    const list = await request(app).get('/api/projects/');
    expect(list.body.map((p: { name: string }) => p.name)).toEqual(['default', 'example-project']);
  });
});

describe('DB migrated past this build mid-session', () => {
  it('refuses writes with 409 and the rebuild/restart message, but still serves reads', async () => {
    const other = createStore(dbPath);
    other.db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(99, 'future-migration');
    other.close();

    const write = await request(app).post('/api/tasks/').send({ project: 'default', type: 'bug', priority: 'high', title: 'x' });
    expect(write.status).toBe(409);
    expect(write.body.error).toMatch(/future-migration.*Rebuild .* restart/);

    const read = await request(app).get('/api/tasks/');
    expect(read.status).toBe(200);
  });
});

describe('/api/keys', () => {
  it('POST returns the key once; GET lists rows without hash or key', async () => {
    const created = await request(app).post('/api/keys/').send({ label: 'laptop', project: 'default' });
    expect(created.status).toBe(200);
    expect(created.headers['cache-control']).toBe('no-store');
    expect(created.body).toEqual({ id: expect.any(Number), label: 'laptop', project: 'default', key: expect.stringMatching(/^stm_[A-Za-z0-9_-]{43}$/) });

    const list = await request(app).get('/api/keys/');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(Object.keys(list.body[0]).sort()).toEqual(['createdAt', 'id', 'label', 'lastUsedAt', 'project', 'revokedAt']);
    expect(JSON.stringify(list.body)).not.toContain(created.body.key);
  });

  it('POST with an empty label → 400', async () => {
    const res = await request(app).post('/api/keys/').send({ label: '  ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/label/);
  });

  it('POST with an unknown project → 400', async () => {
    const res = await request(app).post('/api/keys/').send({ label: 'laptop', project: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nope/);
  });

  it('revoke marks the key and stops it verifying; unknown id → 404', async () => {
    const { body } = await request(app).post('/api/keys/').send({ label: 'laptop', project: 'default' });
    const res = await request(app).post(`/api/keys/${body.id}/revoke`);
    expect(res.status).toBe(200);
    expect(res.body.revokedAt).toEqual(expect.any(String));

    const store = createStore(dbPath);
    try {
      expect(store.verifyApiKey(body.key)).toBeNull();
      expect(store.listApiKeys()).toEqual([]);
    } finally {
      store.close();
    }
    expect((await request(app).post('/api/keys/999/revoke')).status).toBe(404);
  });

  it('task list and SSE-backed routes never carry keys', async () => {
    await request(app).post('/api/keys/').send({ label: 'laptop', project: 'default' });
    const tasks = await request(app).get('/api/tasks/');
    expect(JSON.stringify(tasks.body)).not.toMatch(/stm_|laptop/);
  });
});

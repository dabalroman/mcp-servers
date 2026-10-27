import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { mountTaskApi } from './taskRouter.js';

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

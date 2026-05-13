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
      .send({ type: 'bug', priority: 'high', title: 'Valid task' });
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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTaskStore } from './taskStore.js';

let dir: string;
let dbPath: string;
let store: ReturnType<typeof createTaskStore>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskstore-test-'));
  dbPath = path.join(dir, 'tasks.db');
  store = createTaskStore({ dbPath });
});

afterEach(() => {
  try { store.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('add', () => {
  it('returns id 1 for the first task', async () => {
    const id = await store.add({ type: 'bug', priority: 'high', title: 'First', description: '' });
    expect(id).toBe(1);
  });

  it('increments counter correctly for sequential adds', async () => {
    const id1 = await store.add({ type: 'bug', priority: 'high', title: 'A', description: '' });
    const id2 = await store.add({ type: 'feature', priority: 'low', title: 'B', description: '' });
    expect(id2).toBe(id1 + 1);
  });

  it('persists task across reopen', async () => {
    await store.add({ type: 'tool', priority: 'medium', title: 'Persist me', description: 'details' });
    store.close();
    store = createTaskStore({ dbPath });
    const { active } = store.load();
    expect(active.find((t) => t.title === 'Persist me')).toBeTruthy();
  });
});

describe('setStatus', () => {
  it('returns false for unknown id', async () => {
    expect(await store.setStatus(999, 'done')).toBe(false);
  });

  it('moves task into the done bucket on load when status set to done', async () => {
    const id = await store.add({ type: 'bug', priority: 'high', title: 'Fix me', description: '' });
    expect(await store.setStatus(id, 'done')).toBe(true);
    const { active, done } = store.load();
    expect(active.find((t) => t.id === id)).toBeUndefined();
    expect(done.find((t) => t.id === id)).toBeTruthy();
  });

  it('moves task back to active when un-done', async () => {
    const id = await store.add({ type: 'bug', priority: 'high', title: 'Re-open me', description: '' });
    await store.setStatus(id, 'done');
    expect(await store.setStatus(id, 'todo')).toBe(true);
    const { active } = store.load();
    expect(active.find((t) => t.id === id && t.status === 'todo')).toBeTruthy();
  });
});

describe('updateTask', () => {
  it('returns false for unknown id', async () => {
    expect(await store.updateTask(999, { title: 'Ghost' })).toBe(false);
  });

  it('updates title', async () => {
    const id = await store.add({ type: 'bug', priority: 'high', title: 'Old', description: '' });
    expect(await store.updateTask(id, { title: 'New' })).toBe(true);
    const { active } = store.load();
    expect(active.find((t) => t.id === id)?.title).toBe('New');
  });
});

describe('summary — browser API always returns full data', () => {
  it('load() returns both summary and description when both are set', async () => {
    const id = await store.add({ type: 'bug', priority: 'high', title: 'T', description: 'Full desc.', summary: 'Short gist.' });
    const { active } = store.load();
    const t = active.find((x) => x.id === id);
    expect(t?.summary).toBe('Short gist.');
    expect(t?.description).toBe('Full desc.');
  });

  it('editing a task with a summary does not wipe description (regression test)', async () => {
    const id = await store.add({ type: 'bug', priority: 'high', title: 'T', description: 'Original desc.', summary: 'A gist.' });
    const { active } = store.load();
    const loaded = active.find((t) => t.id === id);
    expect(loaded).toBeDefined();
    expect(loaded!.description).toBe('Original desc.');
    await store.updateTask(id, { title: 'T', description: loaded!.description, summary: loaded!.summary ?? null });
    const { active: after } = store.load();
    expect(after.find((t) => t.id === id)?.description).toBe('Original desc.');
  });
});

describe('deleteTask', () => {
  it('returns false for unknown id', async () => {
    expect(await store.deleteTask(999)).toBe(false);
  });

  it('removes task', async () => {
    const id = await store.add({ type: 'bug', priority: 'high', title: 'Delete me', description: '' });
    expect(await store.deleteTask(id)).toBe(true);
    const { active, done } = store.load();
    expect([...active, ...done].find((t) => t.id === id)).toBeUndefined();
  });
});

describe('dataVersion', () => {
  it('changes when another connection writes (the SSE polling signal)', async () => {
    const before = store.dataVersion();
    const other = createTaskStore({ dbPath });
    await other.add({ type: 'bug', priority: 'high', title: 'from elsewhere', description: '' });
    other.close();
    const after = store.dataVersion();
    expect(after).not.toBe(before);
  });
});

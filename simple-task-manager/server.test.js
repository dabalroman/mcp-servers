/**
 * server.test.js — handler-level tests for the simple-task-manager MCP server.
 *
 * server.js itself is bootstrap-only and cannot be imported directly because it
 * has top-level side-effects (reads TASKS_DB, connects a StdioServerTransport).
 * The handlers it wires up are pure (store, args) => MCPContent fns in
 * mcp/queryHandlers.js and mcp/mutationHandlers.js — we import and exercise
 * those directly here, so the tests cover the real production code path.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from './tasks.js';
import {
  handleGetByType,
  handleGetNext,
  handleGetAll,
  handleGetById,
  handleGetByScope,
  handleGetRelated,
  handleGetByStatus,
} from './mcp/queryHandlers.js';
import {
  handleAdd,
  handleUpdate,
  handleSetStatus,
  handleDelete,
} from './mcp/mutationHandlers.js';

// ── Test infrastructure ───────────────────────────────────────────────────────
let dir;
let dbPath;
let store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-server-test-'));
  dbPath = join(dir, 'tasks.db');
  store = createStore(dbPath);
});

afterEach(() => {
  try { store.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

function addTask(overrides = {}) {
  return store.add({
    type: 'bug',
    priority: 'medium',
    title: 'Test task',
    description: '',
    ...overrides,
  });
}

// Decode the JSON payload from a handler response
function decode(response) {
  return JSON.parse(response.content[0].text);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('add handler', () => {
  test('defaults status to refinement when not specified', async () => {
    const resp = await handleAdd(store, {
      type: 'feature',
      priority: 'low',
      title: 'New feature',
      description: 'some details',
    });
    assert.ok(!resp.isError, 'should not be an error');
    const { id } = decode(resp);
    assert.equal(store.getById(id).status, 'refinement');
  });

  test('returns the new task id', async () => {
    const resp = await handleAdd(store, {
      type: 'bug',
      priority: 'high',
      title: 'A bug',
      description: '',
      status: 'todo',
    });
    const { id } = decode(resp);
    assert.ok(typeof id === 'number' && id > 0);
  });

  test('returns isError for empty title', async () => {
    const resp = await handleAdd(store, {
      type: 'bug',
      priority: 'high',
      title: '   ',
      description: '',
    });
    assert.ok(resp.isError);
    assert.ok(decode(resp).error.includes('title'));
  });
});

describe('setStatus handler — knowledgeReminder', () => {
  test('setting status to done returns knowledgeReminder', async () => {
    const { id } = addTask();
    const resp = await handleSetStatus(store, { id, status: 'done' });
    const payload = decode(resp);
    assert.ok(payload.success);
    assert.ok(typeof payload.knowledgeReminder === 'string' && payload.knowledgeReminder.length > 0,
      'knowledgeReminder should be a non-empty string when transitioning to done');
  });

  test('setting status to in_progress does NOT include knowledgeReminder', async () => {
    const { id } = addTask();
    store.setStatus(id, 'todo');
    const resp = await handleSetStatus(store, { id, status: 'in_progress' });
    const payload = decode(resp);
    assert.ok(payload.success);
    assert.equal(payload.knowledgeReminder, undefined);
  });

  test('setting status to todo does NOT include knowledgeReminder', async () => {
    const { id } = addTask({ summary: 'gist' });
    const resp = await handleSetStatus(store, { id, status: 'todo' });
    const payload = decode(resp);
    assert.ok(payload.success);
    assert.equal(payload.knowledgeReminder, undefined);
  });

  test('setting status to refinement does NOT include knowledgeReminder', async () => {
    const { id } = addTask();
    store.setStatus(id, 'todo');
    const resp = await handleSetStatus(store, { id, status: 'refinement' });
    const payload = decode(resp);
    assert.ok(payload.success);
    assert.equal(payload.knowledgeReminder, undefined);
  });

  test('unknown id returns isError', async () => {
    const resp = await handleSetStatus(store, { id: 9999, status: 'done' });
    const payload = decode(resp);
    assert.ok(resp.isError, 'setStatus uses errorText() for not-found');
    assert.ok(payload.error.includes('9999'));
  });
});

describe('getById handler', () => {
  test('returns isError for unknown id', async () => {
    const resp = await handleGetById(store, { id: 9999 });
    assert.ok(resp.isError);
    assert.ok(decode(resp).error.includes('9999'));
  });

  test('returns task for known id', async () => {
    const { id } = addTask({ title: 'My task' });
    const resp = await handleGetById(store, { id });
    assert.ok(!resp.isError);
    assert.equal(decode(resp).task.title, 'My task');
  });

  test('error message lists valid IDs', async () => {
    addTask({ title: 'First' });
    const resp = await handleGetById(store, { id: 9999 });
    const errMsg = decode(resp).error;
    assert.ok(errMsg.includes('1'), 'error should list id 1 as a valid ID');
  });
});

describe('getRelated handler', () => {
  test('returns isError for unknown id', async () => {
    const resp = await handleGetRelated(store, { id: 9999 });
    assert.ok(resp.isError);
    assert.ok(decode(resp).error.includes('9999'));
  });

  test('returns task with outbound and inbound arrays for known id', async () => {
    const { id } = addTask();
    const resp = await handleGetRelated(store, { id });
    assert.ok(!resp.isError);
    const payload = decode(resp);
    assert.ok('task' in payload);
    assert.ok(Array.isArray(payload.outbound));
    assert.ok(Array.isArray(payload.inbound));
  });
});

describe('list-mode stripping (server layer)', () => {
  function addWithSummary(overrides = {}) {
    return store.add({ type: 'bug', priority: 'medium', title: 'T', description: 'Long desc.', summary: 'Short gist.', ...overrides });
  }

  test('getByStatus strips description when summary present', async () => {
    const { id } = addWithSummary({ status: 'todo' });
    const { tasks } = decode(await handleGetByStatus(store, { status: 'todo' }));
    const t = tasks.find((x) => x.id === id);
    assert.equal(t.summary, 'Short gist.');
    assert.equal(t.description, undefined);
  });

  test('getByStatus keeps description when no summary', async () => {
    const { id } = store.add({ type: 'bug', priority: 'medium', title: 'T', description: 'Long desc.', status: 'todo' });
    const { tasks } = decode(await handleGetByStatus(store, { status: 'todo' }));
    const t = tasks.find((x) => x.id === id);
    assert.equal(t.description, 'Long desc.');
    assert.equal(t.summary, undefined);
  });

  test('getByScope strips description when summary present', async () => {
    const { id } = addWithSummary({ scope: 'x' });
    const { tasks } = decode(await handleGetByScope(store, { scope: 'x' }));
    const t = tasks.find((x) => x.id === id);
    assert.equal(t.summary, 'Short gist.');
    assert.equal(t.description, undefined);
  });

  test('getByType strips description when summary present', async () => {
    const { id } = addWithSummary({ type: 'feature' });
    const { tasks } = decode(await handleGetByType(store, { type: 'feature' }));
    const t = tasks.find((x) => x.id === id);
    assert.equal(t.summary, 'Short gist.');
    assert.equal(t.description, undefined);
  });

  test('getNext strips description when summary present', async () => {
    addWithSummary({ type: 'bug', priority: 'high', status: 'todo' });
    const { task } = decode(await handleGetNext(store, {}));
    assert.equal(task.summary, 'Short gist.');
    assert.equal(task.description, undefined);
  });

  test('getAll strips description when summary present', async () => {
    const { id } = addWithSummary({ type: 'bug' });
    const { tasks } = decode(await handleGetAll(store));
    const t = tasks.bug.find((x) => x.id === id);
    assert.equal(t.summary, 'Short gist.');
    assert.equal(t.description, undefined);
  });

  test('getById always returns both fields', async () => {
    const { id } = addWithSummary();
    const { task } = decode(await handleGetById(store, { id }));
    assert.equal(task.summary, 'Short gist.');
    assert.equal(task.description, 'Long desc.');
  });

  test('getRelated: anchor full, outbound/inbound stripped', async () => {
    const { id: a } = addWithSummary({ type: 'bug', title: 'A', description: 'A desc.', summary: 'A gist.' });
    const { id: b } = store.add({ type: 'bug', priority: 'medium', title: 'B', description: 'B desc.', summary: 'B gist.', refs: [{ id: a, relation: 'blocks' }] });
    const payload = decode(await handleGetRelated(store, { id: b }));
    assert.equal(payload.task.summary, 'B gist.');
    assert.equal(payload.task.description, 'B desc.');
    assert.equal(payload.outbound[0].summary, 'A gist.');
    assert.equal(payload.outbound[0].description, undefined);
  });
});

describe('delete handler', () => {
  test('returns isError for unknown id', async () => {
    const resp = await handleDelete(store, { id: 9999 });
    assert.ok(resp.isError);
    assert.ok(decode(resp).error.includes('9999'));
  });

  test('returns success:true for existing id', async () => {
    const { id } = addTask();
    const resp = await handleDelete(store, { id });
    assert.ok(!resp.isError);
    assert.equal(decode(resp).success, true);
    assert.equal(store.getById(id), null);
  });
});

describe('setStatus handler — summary enforcement', () => {
  test('refinement→todo without summary returns isError', async () => {
    const { id } = addTask({ status: 'refinement' });
    const resp = await handleSetStatus(store, { id, status: 'todo' });
    assert.ok(resp.isError, 'should be an error');
    assert.ok(decode(resp).error.includes('summary'), 'error should mention summary');
    assert.ok(decode(resp).error.includes(String(id)));
  });

  test('refinement→todo WITH summary succeeds', async () => {
    const { id } = addTask({ status: 'refinement' });
    store.update(id, { summary: 'A proper gist.' });
    const resp = await handleSetStatus(store, { id, status: 'todo' });
    assert.ok(!resp.isError);
    assert.equal(decode(resp).success, true);
  });

  test('todo→done does NOT require summary', async () => {
    const { id } = addTask({ status: 'refinement' });
    store.setStatus(id, 'todo');
    const resp = await handleSetStatus(store, { id, status: 'done' });
    assert.ok(!resp.isError);
    assert.equal(decode(resp).success, true);
  });

  test('in_progress→todo is not blocked by summary check', async () => {
    const { id } = addTask({ status: 'refinement' });
    store.setStatus(id, 'in_progress');
    const resp = await handleSetStatus(store, { id, status: 'todo' });
    assert.ok(!resp.isError, 'in_progress→todo should not be blocked');
  });
});

describe('update handler — summaryReminder', () => {
  test('updating a refinement task without summary returns summaryReminder', async () => {
    const { id } = addTask({ status: 'refinement' });
    const resp = await handleUpdate(store, { id, title: 'Updated title' });
    assert.ok(!resp.isError);
    const payload = decode(resp);
    assert.ok(typeof payload.summaryReminder === 'string', 'summaryReminder should be present');
    assert.ok(payload.summaryReminder.includes('summary'));
  });

  test('updating a refinement task WITH summary does NOT return summaryReminder', async () => {
    const { id } = addTask({ status: 'refinement' });
    store.update(id, { summary: 'Already set.' });
    const resp = await handleUpdate(store, { id, title: 'Updated title' });
    const payload = decode(resp);
    assert.equal(payload.summaryReminder, undefined);
  });

  test('updating a todo task does NOT return summaryReminder', async () => {
    const { id } = addTask({ status: 'refinement' });
    store.update(id, { summary: 'gist' });
    store.setStatus(id, 'todo');
    const resp = await handleUpdate(store, { id, title: 'Updated' });
    const payload = decode(resp);
    assert.equal(payload.summaryReminder, undefined);
  });

  test('update with summary: null on refinement task returns summaryReminder', async () => {
    const { id } = addTask({ status: 'refinement', summary: 'Existing.' });
    const resp = await handleUpdate(store, { id, summary: null });
    const payload = decode(resp);
    assert.ok(typeof payload.summaryReminder === 'string', 'reminder should fire when summary is cleared on refinement task');
  });
});

describe('getAll handler', () => {
  test('excludes done tasks', async () => {
    addTask({ type: 'bug', title: 'Active bug' });
    const { id: doneId } = addTask({ type: 'bug', title: 'Resolved bug' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetAll(store);
    const { tasks } = decode(resp);
    const bugs = tasks.bug ?? [];
    assert.ok(bugs.every((t) => t.status !== 'done'), 'done tasks must not appear in getAll');
    assert.equal(bugs.length, 1);
    assert.equal(bugs[0].title, 'Active bug');
  });

  test('omits type key entirely when all tasks of that type are done', async () => {
    const { id } = addTask({ type: 'idea', title: 'An idea' });
    store.setStatus(id, 'done');
    addTask({ type: 'bug', title: 'Live bug' });

    const resp = await handleGetAll(store);
    const { tasks } = decode(resp);
    assert.ok(!('idea' in tasks), 'idea key should be absent when all idea tasks are done');
    assert.ok('bug' in tasks);
  });

  test('returns empty grouped object when everything is done', async () => {
    const { id } = addTask({ type: 'bug' });
    store.setStatus(id, 'done');

    const resp = await handleGetAll(store);
    const { tasks } = decode(resp);
    assert.deepEqual(tasks, {});
  });
});

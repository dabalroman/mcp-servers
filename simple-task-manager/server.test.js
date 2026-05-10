/**
 * server.test.js — handler-level tests for the simple-task-manager MCP server.
 *
 * server.js cannot be imported directly because it has top-level side-effects
 * (reads TASKS_DB env var, throws if absent, connects a StdioServerTransport).
 * Instead, we instantiate the store directly and replicate the handler bodies
 * verbatim from server.js — the handlers are thin wrappers and this approach
 * lets us test the observable behaviour without mocking the MCP SDK.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore, RELATIONS } from './tasks.js';

// ── Helpers that mirror server.js exactly ────────────────────────────────────
const text      = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });
const errorText = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }], isError: true });

function allIdsSorted(store) {
  const { active, done } = store.load();
  return [...active.map((t) => t.id), ...done.map((t) => t.id)].sort((a, b) => a - b);
}

// Handler implementations copied from server.js (unchanged)
async function handleAdd(store, args) {
  const { type, priority, title, description, scope, refs, status } = args;
  try {
    const { id } = store.add({ type, priority, title, description, scope, refs, status });
    return text({ id });
  } catch (err) {
    return errorText({ error: err.message });
  }
}

async function handleGetById(store, { id }) {
  const task = store.getById(id);
  if (!task) {
    return errorText({ error: `Task #${id} not found. Valid IDs: ${allIdsSorted(store).join(', ') || 'none'}` });
  }
  return text({ task });
}

async function handleSetStatus(store, { id, status }) {
  const ok = store.setStatus(id, status);
  if (!ok) {
    return text({ success: false, error: `Task #${id} not found. Valid IDs are: ${allIdsSorted(store).join(', ') || 'none'}` });
  }
  const result = { success: true };
  if (status === 'done') {
    result.knowledgeReminder = 'Task closed. Before moving on: (1) identify non-obvious decisions, gotchas, conventions, or architecture changes from this task; (2) update the closest relevant CLAUDE.md with anything genuinely new — keep entries terse and deduped; (3) prune or correct any entries now stale or contradicted. Skip if nothing worth capturing.';
  }
  return text(result);
}

async function handleGetRelated(store, { id }) {
  const result = store.getRelated(id);
  if (!result) {
    return errorText({ error: `Task #${id} not found. Valid IDs: ${allIdsSorted(store).join(', ') || 'none'}` });
  }
  return text(result);
}

async function handleDelete(store, { id }) {
  const ok = store.delete(id);
  if (!ok) {
    return errorText({ success: false, error: `Task #${id} not found. Valid IDs are: ${allIdsSorted(store).join(', ') || 'none'}` });
  }
  return text({ success: true });
}

async function handleGetAll(store) {
  const allTypes = ['bug', 'feature', 'idea', 'tool', 'other'];
  const grouped = {};
  for (const type of allTypes) {
    const ofType = store.getByType(type).filter((t) => t.status !== 'done');
    if (ofType.length > 0) grouped[type] = ofType;
  }
  return text({ tasks: grouped });
}

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
    const { id } = addTask();
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

  test('unknown id returns success:false (not isError)', async () => {
    const resp = await handleSetStatus(store, { id: 9999, status: 'done' });
    const payload = decode(resp);
    assert.ok(!resp.isError, 'setStatus uses text() not errorText() for not-found');
    assert.equal(payload.success, false);
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

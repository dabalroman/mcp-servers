/**
 * server.test.ts — handler-level tests for the simple-task-manager MCP server.
 *
 * server.ts itself is bootstrap-only and cannot be imported directly because it
 * has top-level side-effects (reads TASKS_DB, connects a StdioServerTransport).
 * The handlers it wires up are pure (store, args) => MCPContent fns in
 * mcp/queryHandlers.ts and mcp/mutationHandlers.ts — we import and exercise
 * those directly here, so the tests cover the real production code path.
 */

import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore, parseSince, type AddInput, type Store, type StatusFilter } from './tasks.js';
import { buildInstructions } from './instructions.js';
import { PACKAGE_DIR } from './packageDir.js';
import { ENV_ORDER } from './mcpConfig.js';
import {
  handleGetNext,
  handleGetAll,
  handleGetById,
  handleGetByExternalId,
  handleGetByPr,
  handleGetUpdates,
  handleGetRelated,
  handleGetOverview,
  handleGetScopes,
  handleGetProjects,
  handleHealth,
} from './mcp/queryHandlers.js';
import {
  handleAdd,
  handleUpdate,
  handleReplace,
  handleAddNote,
  handleUpdateNote,
  handleDeleteNote,
  handleSetStatus,
  handleDelete,
  handleCreateProject,
  handleUpdateProject,
  handleReorder,
} from './mcp/mutationHandlers.js';
import { withSchemaCheck, prsSchema, type MCPContent } from './mcp/shared.js';
import Database from 'better-sqlite3';
import { resetUpdateCheckCache } from './updateCheck.js';
import { VERSION } from './version.js';

let dir: string;
let dbPath: string;
let store: Store;
const CTX = { project: 'default' };

const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async () => { throw new Error('network disabled in tests'); }) as unknown as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-server-test-'));
  dbPath = join(dir, 'tasks.db');
  store = createStore(dbPath);
});

afterEach(() => {
  try { store.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

function addTask(overrides: Partial<AddInput> = {}): { id: number } {
  return store.add({
    project: 'default',
    type: 'bug',
    priority: 'medium',
    title: 'Test task',
    description: '',
    ...overrides,
  });
}

function decode(response: MCPContent): Record<string, unknown> {
  return JSON.parse(response.content[0]!.text) as Record<string, unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('add handler', () => {
  test('defaults status to refinement when not specified', async () => {
    const resp = handleAdd(store, {
      type: 'feature',
      priority: 'low',
      title: 'New feature',
      description: 'some details',
    }, CTX);
    assert.ok(!resp.isError, 'should not be an error');
    const { id } = decode(resp) as { id: number };
    assert.equal(store.getById(id)?.status, 'refinement');
  });

  test('returns the new task id', async () => {
    const resp = handleAdd(store, {
      type: 'bug',
      priority: 'high',
      title: 'A bug',
      description: '',
      status: 'todo',
    }, CTX);
    const { id } = decode(resp) as { id: number };
    assert.ok(typeof id === 'number' && id > 0);
  });

  test('returned task has created_at and updated_at timestamp strings', async () => {
    const resp = handleAdd(store, {
      type: 'feature',
      priority: 'medium',
      title: 'Timestamp test',
      description: '',
      status: 'todo',
    }, CTX);
    const { id } = decode(resp) as { id: number };
    const task = store.getById(id);
    assert.ok(task, 'task should exist');
    assert.ok(typeof task.created_at === 'string' && task.created_at.length > 0, 'created_at should be a non-empty string');
    assert.ok(typeof task.updated_at === 'string' && task.updated_at.length > 0, 'updated_at should be a non-empty string');
  });

  test('returns isError for empty title', async () => {
    const resp = handleAdd(store, {
      type: 'bug',
      priority: 'high',
      title: '   ',
      description: '',
    }, CTX);
    assert.ok(resp.isError);
    assert.ok((decode(resp).error as string).includes('title'));
  });
});

describe('setStatus handler — knowledgeReminder', () => {
  test('setting status to done returns knowledgeReminder', async () => {
    const { id } = addTask();
    const resp = handleSetStatus(store, { id, status: 'done' });
    const payload = decode(resp);
    assert.ok(payload.success);
    assert.ok(typeof payload.knowledgeReminder === 'string' && (payload.knowledgeReminder as string).length > 0,
      'knowledgeReminder should be a non-empty string when transitioning to done');
  });

  test('setting status to in_progress does NOT include knowledgeReminder', async () => {
    const { id } = addTask();
    store.setStatus(id, 'todo');
    const resp = handleSetStatus(store, { id, status: 'in_progress' });
    const payload = decode(resp);
    assert.ok(payload.success);
    assert.equal(payload.knowledgeReminder, undefined);
  });

  test('setting status to todo does NOT include knowledgeReminder', async () => {
    const { id } = addTask({ summary: 'gist' });
    const resp = handleSetStatus(store, { id, status: 'todo' });
    const payload = decode(resp);
    assert.ok(payload.success);
    assert.equal(payload.knowledgeReminder, undefined);
  });

  test('setting status to refinement does NOT include knowledgeReminder', async () => {
    const { id } = addTask();
    store.setStatus(id, 'todo');
    const resp = handleSetStatus(store, { id, status: 'refinement' });
    const payload = decode(resp);
    assert.ok(payload.success);
    assert.equal(payload.knowledgeReminder, undefined);
  });

  test('unknown id returns isError', async () => {
    const resp = handleSetStatus(store, { id: 9999, status: 'done' });
    const payload = decode(resp);
    assert.ok(resp.isError, 'setStatus uses errorText() for not-found');
    assert.ok((payload.error as string).includes('9999'));
  });
});

describe('getById handler', () => {
  test('returns isError for unknown id', async () => {
    const resp = await handleGetById(store, { id: 9999 });
    assert.ok(resp.isError);
    assert.ok((decode(resp).error as string).includes('9999'));
  });

  test('returns task for known id', async () => {
    const { id } = addTask({ title: 'My task' });
    const resp = await handleGetById(store, { id });
    assert.ok(!resp.isError);
    assert.equal((decode(resp).task as { title: string }).title, 'My task');
  });

  test('error message lists valid IDs', async () => {
    addTask({ title: 'First' });
    const resp = await handleGetById(store, { id: 9999 });
    const errMsg = decode(resp).error as string;
    assert.ok(errMsg.includes('1'), 'error should list id 1 as a valid ID');
  });
});

describe('plan text check on add/update', () => {
  test('add normalises CRLF and rejects control characters', () => {
    const ok = handleAdd(store, { type: 'bug', priority: 'low', title: 't', description: '', status: 'refinement', plan: 'a\r\nb' }, CTX);
    assert.ok(!ok.isError);
    assert.equal(store.getById(decode(ok).id as number)?.plan, 'a\nb');
    const bad = handleAdd(store, { type: 'bug', priority: 'low', title: 't', description: '', status: 'refinement', plan: 'a\u0000b' }, CTX);
    assert.ok(bad.isError);
    assert.match(decode(bad).error as string, /U\+0000/);
  });

  test('update rejects control characters and leaves the plan; empty still clears', () => {
    const { id } = addTask({ plan: 'keep me' });
    const bad = handleUpdate(store, { id, plan: 'x\u001b[0m' });
    assert.ok(bad.isError);
    assert.equal(store.getById(id)?.plan, 'keep me');
    assert.ok(!handleUpdate(store, { id, plan: 'a\rb' }).isError);
    assert.equal(store.getById(id)?.plan, 'a\nb');
    assert.ok(!handleUpdate(store, { id, plan: '' }).isError);
    assert.equal(store.getById(id)?.plan, undefined);
  });
});

describe('getRelated handler', () => {
  test('returns isError for unknown id', async () => {
    const resp = await handleGetRelated(store, { id: 9999 });
    assert.ok(resp.isError);
    assert.ok((decode(resp).error as string).includes('9999'));
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
  function addWithSummary(overrides: Partial<AddInput> = {}): { id: number } {
    return store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'T', description: 'Long desc.', summary: 'Short gist.', ...overrides });
  }

  test('getAll strips description when summary present', async () => {
    const { id } = addWithSummary({ status: 'todo' });
    const { tasks } = decode(await handleGetAll(store, {}, CTX)) as { tasks: Record<string, { id: number; summary?: string; description?: string }[]> };
    const t = tasks.bug?.find((x) => x.id === id);
    assert.equal(t?.summary, 'Short gist.');
    assert.equal(t?.description, undefined);
  });

  test('getAll keeps description when no summary', async () => {
    const { id } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'T', description: 'Long desc.', status: 'todo' });
    const { tasks } = decode(await handleGetAll(store, {}, CTX)) as { tasks: Record<string, { id: number; summary?: string; description?: string }[]> };
    const t = tasks.bug?.find((x) => x.id === id);
    assert.equal(t?.description, 'Long desc.');
    assert.equal(t?.summary, undefined);
  });

  test('getNext strips description when summary present', async () => {
    addWithSummary({ type: 'bug', priority: 'high', status: 'todo' });
    const { task } = decode(await handleGetNext(store, {}, CTX)) as { task: { summary?: string; description?: string } };
    assert.equal(task.summary, 'Short gist.');
    assert.equal(task.description, undefined);
  });

  test('getAll strips description when summary present', async () => {
    const { id } = addWithSummary({ type: 'bug' });
    const { tasks } = decode(await handleGetAll(store, {}, CTX)) as { tasks: Record<string, { id: number; summary?: string; description?: string }[]> };
    const t = tasks.bug?.find((x) => x.id === id);
    assert.equal(t?.summary, 'Short gist.');
    assert.equal(t?.description, undefined);
  });

  test('getById always returns both fields', async () => {
    const { id } = addWithSummary();
    const { task } = decode(await handleGetById(store, { id })) as { task: { summary?: string; description?: string } };
    assert.equal(task.summary, 'Short gist.');
    assert.equal(task.description, 'Long desc.');
  });

  test('getRelated: anchor and outbound/inbound all list mode', async () => {
    const { id: a } = addWithSummary({ type: 'bug', title: 'A', description: 'A desc.', summary: 'A gist.' });
    const { id: b } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'B', description: 'B desc.', summary: 'B gist.', refs: [{ id: a, relation: 'blocks' }] });
    const payload = decode(await handleGetRelated(store, { id: b })) as {
      task: { summary?: string; description?: string };
      outbound: { summary?: string; description?: string }[];
    };
    assert.equal(payload.task.summary, 'B gist.');
    assert.equal(payload.task.description, undefined);
    assert.equal(payload.outbound[0]?.summary, 'A gist.');
    assert.equal(payload.outbound[0]?.description, undefined);
  });
});

describe('delete handler', () => {
  test('returns isError for unknown id', async () => {
    const resp = handleDelete(store, { id: 9999 });
    assert.ok(resp.isError);
    assert.ok((decode(resp).error as string).includes('9999'));
  });

  test('returns success:true for existing id', async () => {
    const { id } = addTask();
    const resp = handleDelete(store, { id });
    assert.ok(!resp.isError);
    assert.equal((decode(resp) as { success: boolean }).success, true);
    assert.equal(store.getById(id), null);
  });
});

describe('setStatus handler — summary enforcement', () => {
  test('refinement→todo without summary returns isError', async () => {
    const { id } = addTask({ status: 'refinement' });
    const resp = handleSetStatus(store, { id, status: 'todo' });
    assert.ok(resp.isError, 'should be an error');
    assert.ok((decode(resp).error as string).includes('summary'), 'error should mention summary');
    assert.ok((decode(resp).error as string).includes(String(id)));
  });

  test('refinement→todo WITH summary succeeds', async () => {
    const { id } = addTask({ status: 'refinement' });
    store.update(id, { summary: 'A proper gist.' });
    const resp = handleSetStatus(store, { id, status: 'todo' });
    assert.ok(!resp.isError);
    assert.equal((decode(resp) as { success: boolean }).success, true);
  });

  test('todo→done does NOT require summary', async () => {
    const { id } = addTask({ status: 'refinement' });
    store.setStatus(id, 'todo');
    const resp = handleSetStatus(store, { id, status: 'done' });
    assert.ok(!resp.isError);
    assert.equal((decode(resp) as { success: boolean }).success, true);
  });

  test('in_progress→todo is not blocked by summary check', async () => {
    const { id } = addTask({ status: 'refinement' });
    store.setStatus(id, 'in_progress');
    const resp = handleSetStatus(store, { id, status: 'todo' });
    assert.ok(!resp.isError, 'in_progress→todo should not be blocked');
  });
});

describe('replace handler', () => {
  test('single match in description is replaced; ack has no task body', () => {
    const { id } = addTask({ description: 'alpha beta gamma' });
    const resp = handleReplace(store, { id, field: 'description', anchor: 'beta', replace_with: 'delta' });
    assert.ok(!resp.isError);
    assert.deepEqual(decode(resp), { success: true, id, field: 'description' });
    assert.equal(store.getById(id)!.description, 'alpha delta gamma');
  });

  test('single match in plan is replaced', () => {
    const { id } = addTask({ plan: 'step one\nstep two' });
    const resp = handleReplace(store, { id, field: 'plan', anchor: 'step two', replace_with: 'step 2' });
    assert.ok(!resp.isError);
    assert.equal(store.getById(id)!.plan, 'step one\nstep 2');
  });

  test('empty replace_with deletes the anchor', () => {
    const { id } = addTask({ description: 'keep REMOVE keep' });
    handleReplace(store, { id, field: 'description', anchor: 'REMOVE ', replace_with: '' });
    assert.equal(store.getById(id)!.description, 'keep keep');
  });

  test('0 matches errors and leaves field unchanged', () => {
    const { id } = addTask({ description: 'alpha' });
    const resp = handleReplace(store, { id, field: 'description', anchor: 'ALPHA', replace_with: 'x' });
    assert.ok(resp.isError);
    assert.ok((decode(resp).error as string).includes('not found'));
    assert.equal(store.getById(id)!.description, 'alpha');
  });

  test('2 matches errors with count and leaves field unchanged', () => {
    const { id } = addTask({ description: 'foo bar foo' });
    const resp = handleReplace(store, { id, field: 'description', anchor: 'foo', replace_with: 'x' });
    assert.ok(resp.isError);
    assert.ok((decode(resp).error as string).includes('matched 2 times'));
    assert.equal(store.getById(id)!.description, 'foo bar foo');
  });

  test('overlapping matches count as 2', () => {
    const { id } = addTask({ description: 'aaa' });
    const resp = handleReplace(store, { id, field: 'description', anchor: 'aa', replace_with: 'x' });
    assert.ok(resp.isError);
    assert.ok((decode(resp).error as string).includes('matched 2 times'));
  });

  test('task with no plan errors as not found', () => {
    const { id } = addTask();
    const resp = handleReplace(store, { id, field: 'plan', anchor: 'x', replace_with: 'y' });
    assert.ok(resp.isError);
    assert.ok((decode(resp).error as string).includes('not found'));
  });

  test('unknown id errors', () => {
    const resp = handleReplace(store, { id: 9999, field: 'description', anchor: 'x', replace_with: 'y' });
    assert.ok(resp.isError);
    assert.ok((decode(resp).error as string).includes('Task #9999 not found'));
  });

  test('$& in replace_with is inserted literally', () => {
    const { id } = addTask({ description: 'price: X' });
    handleReplace(store, { id, field: 'description', anchor: 'X', replace_with: '$& $1' });
    assert.equal(store.getById(id)!.description, 'price: $& $1');
  });
});

describe('update handler — summaryReminder', () => {
  test('updating a refinement task without summary returns summaryReminder', async () => {
    const { id } = addTask({ status: 'refinement' });
    const resp = handleUpdate(store, { id, title: 'Updated title' });
    assert.ok(!resp.isError);
    const payload = decode(resp);
    assert.ok(typeof payload.summaryReminder === 'string', 'summaryReminder should be present');
    assert.ok((payload.summaryReminder as string).includes('summary'));
  });

  test('updating a refinement task WITH summary does NOT return summaryReminder', async () => {
    const { id } = addTask({ status: 'refinement' });
    store.update(id, { summary: 'Already set.' });
    const resp = handleUpdate(store, { id, title: 'Updated title' });
    const payload = decode(resp);
    assert.equal(payload.summaryReminder, undefined);
  });

  test('updating a todo task does NOT return summaryReminder', async () => {
    const { id } = addTask({ status: 'refinement' });
    store.update(id, { summary: 'gist' });
    store.setStatus(id, 'todo');
    const resp = handleUpdate(store, { id, title: 'Updated' });
    const payload = decode(resp);
    assert.equal(payload.summaryReminder, undefined);
  });

  test('update with summary: null does NOT return summaryReminder (caller explicitly touched summary)', async () => {
    const { id } = addTask({ status: 'refinement', summary: 'Existing.' });
    const resp = handleUpdate(store, { id, summary: null });
    const payload = decode(resp);
    assert.equal(payload.summaryReminder, undefined, 'no reminder when patch includes summary key');
  });

  test('updating other fields on summary-less refinement task returns summaryReminder', async () => {
    const { id } = addTask({ status: 'refinement' });
    const resp = handleUpdate(store, { id, description: 'More context.' });
    const payload = decode(resp);
    assert.ok(typeof payload.summaryReminder === 'string', 'reminder fires when patch ignores summary');
  });
});

describe('plan field — MCP layer', () => {
  test('update response omits plan but stores it', () => {
    const { id } = addTask();
    const resp = handleUpdate(store, { id, plan: 'x' });
    const { task } = decode(resp) as { task: { plan?: string } };
    assert.equal(task.plan, undefined);
    assert.equal(store.getById(id)?.plan, 'x');
  });

  test('update response omits note bodies but keeps noteCount', () => {
    const { id } = addTask();
    store.addNote(id, 'n1');
    store.addNote(id, 'n2');
    const { task } = decode(handleUpdate(store, { id, priority: 'high' })) as { task: { notes?: unknown; noteCount?: number } };
    assert.equal(task.notes, undefined);
    assert.equal(task.noteCount, 2);
  });

  test('add handler accepts plan and persists it; getById returns it', () => {
    const resp = handleAdd(store, {
      type: 'feature',
      priority: 'medium',
      title: 'Planned task',
      description: '',
      plan: '# My Plan\n\n- step 1',
    }, CTX);
    const { id } = decode(resp) as { id: number };
    const task = store.getById(id);
    assert.equal(task?.plan, '# My Plan\n\n- step 1');
  });

  test('getById returns plan intact', async () => {
    const { id } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'T', description: '', plan: '## Plan\n\nDo the thing.' });
    const resp = await handleGetById(store, { id });
    const { task } = decode(resp) as { task: { plan?: string } };
    assert.equal(task.plan, '## Plan\n\nDo the thing.');
  });

  test('getAll strips plan from list responses', async () => {
    store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'T', description: '', plan: 'secret plan', status: 'todo' });
    const { tasks } = decode(await handleGetAll(store, {}, CTX)) as { tasks: Record<string, { plan?: string }[]> };
    const all = Object.values(tasks).flat();
    assert.ok(all.every((t) => t.plan === undefined), 'plan must not appear in getAll results');
  });

  test('getNext strips plan from list response', async () => {
    store.add({ project: 'default', type: 'bug', priority: 'high', title: 'T', description: '', plan: 'secret plan', status: 'todo' });
    const { task } = decode(await handleGetNext(store, {}, CTX)) as { task: { plan?: string } };
    assert.equal(task.plan, undefined, 'plan must not appear in getNext result');
  });

  test('getAll strips plan from list responses', async () => {
    store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'T', description: '', plan: 'secret plan' });
    const { tasks } = decode(await handleGetAll(store, {}, CTX)) as { tasks: Record<string, { plan?: string }[]> };
    const all = Object.values(tasks).flat();
    assert.ok(all.every((t) => t.plan === undefined), 'plan must not appear in getAll results');
  });

  test('getRelated strips plan and note bodies from the anchor and related tasks', async () => {
    const { id: a } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'A', description: '', plan: 'plan A' });
    const { id: b } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'B', description: '', plan: 'plan B', refs: [{ id: a, relation: 'blocks' }] });
    const payload = decode(await handleGetRelated(store, { id: b })) as {
      task: { plan?: string };
      outbound: { plan?: string }[];
    };
    assert.equal(payload.task.plan, undefined, 'anchor should not include plan');
    assert.equal(payload.outbound[0]?.plan, undefined, 'outbound should not include plan');
    store.addNote(b, 'n');
    const withNote = decode(await handleGetRelated(store, { id: b })) as { task: { notes?: unknown; noteCount?: number } };
    assert.equal(withNote.task.notes, undefined);
    assert.equal(withNote.task.noteCount, 1);
  });
});

describe('plan status — MCP layer', () => {
  test('setStatus handler accepts plan', () => {
    const { id } = addTask({ status: 'refinement' });
    const resp = handleSetStatus(store, { id, status: 'plan' });
    assert.ok(!resp.isError);
    assert.equal((decode(resp) as { success: boolean }).success, true);
    assert.equal(store.getById(id)?.status, 'plan');
  });

  test('add handler accepts initial status plan', () => {
    const resp = handleAdd(store, {
      type: 'feature',
      priority: 'medium',
      title: 'Plan-status task',
      description: '',
      status: 'plan',
    }, CTX);
    assert.ok(!resp.isError);
    const { id } = decode(resp) as { id: number };
    assert.equal(store.getById(id)?.status, 'plan');
  });

  test('setStatus plan does NOT require summary (no gate)', () => {
    const { id } = addTask({ status: 'refinement' });
    const resp = handleSetStatus(store, { id, status: 'plan' });
    assert.ok(!resp.isError, 'plan transition should not be blocked by missing summary');
  });

  test('plan→todo is not blocked by summary check (plan tasks have no gate)', () => {
    const { id } = addTask({ status: 'refinement' });
    store.setStatus(id, 'plan');
    const resp = handleSetStatus(store, { id, status: 'todo' });
    assert.ok(!resp.isError, 'plan→todo should not be blocked');
  });
});

describe('list tools — status filter', () => {
  type Listed = { id: number; status: string };
  const flat = (resp: MCPContent) => Object.values((decode(resp) as { tasks: Record<string, Listed[]> }).tasks).flat();
  const lists: [string, (anchor: number, status?: StatusFilter) => Promise<Listed[]>][] = [
    ['getAll', async (_a, status) => flat(await handleGetAll(store, { status }, CTX))],
    ['getAll { type }', async (_a, status) => flat(await handleGetAll(store, { status, type: 'feature' }, CTX))],
    ['getAll { scope }', async (_a, status) => flat(await handleGetAll(store, { status, scope: 'myapp' }, CTX))],
    ['getAll { type, scope }', async (_a, status) => flat(await handleGetAll(store, { status, type: 'feature', scope: 'myapp' }, CTX))],
    ['getRelated', async (anchor, status) => (decode(await handleGetRelated(store, { id: anchor, status })) as { inbound: Listed[] }).inbound],
  ];
  const NON_DONE = ['in_progress', 'plan', 'refinement', 'todo'];
  const cases: [StatusFilter | undefined, string[]][] = [
    [undefined, NON_DONE],
    ['open', NON_DONE],
    ['refinement', ['refinement']],
    ['plan', ['plan']],
    ['todo', ['todo']],
    ['in_progress', ['in_progress']],
    ['done', ['done']],
  ];

  // One fixture task per status, all inbound to the anchor so getRelated sees them too.
  function seed(): { anchor: number; ids: Set<number> } {
    const anchor = addTask({ type: 'other', title: 'Anchor' }).id;
    const make = (status: 'refinement' | 'plan' | 'todo') =>
      addTask({ type: 'feature', scope: 'myapp', summary: 'x', status, refs: [{ id: anchor, relation: 'blocks' }] }).id;
    const ids = [make('refinement'), make('plan'), make('todo'), make('todo'), make('todo')];
    store.setStatus(ids[3]!, 'in_progress');
    store.setStatus(ids[4]!, 'done');
    return { anchor, ids: new Set(ids) };
  }

  for (const [name, list] of lists) {
    for (const [status, expected] of cases) {
      test(`${name} with status ${status ?? '(none)'} returns ${expected.join('+')}`, async () => {
        const { anchor, ids } = seed();
        const got = (await list(anchor, status)).filter((t) => ids.has(t.id)).map((t) => t.status).sort();
        assert.deepEqual(got, expected);
      });
    }
  }
});

describe('getOverview handler — status filter', () => {
  test('no status omits done tasks from counts', async () => {
    store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Active', description: '', status: 'refinement' });
    const { id: doneId } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Done', description: '', status: 'refinement' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetOverview(store, {}, CTX);
    const { overview } = decode(resp) as { overview: { type: string; refinement: number; plan: number; open: number; done: number }[] };
    const bugEntry = overview.find((o) => o.type === 'bug');
    assert.ok(bugEntry, 'bug entry should exist');
    assert.equal(bugEntry.done, 0, 'done count should be 0 when filtering non-done');
    assert.equal(bugEntry.refinement, 1);
  });

  test('status: "done" shows only done tasks — returns count shape, not three-bucket', async () => {
    store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Active', description: '', status: 'refinement' });
    const { id: doneId } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Done', description: '', status: 'refinement' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetOverview(store, { status: 'done' }, CTX);
    const { overview } = decode(resp) as { overview: { type: string; count: number; status: string }[] };
    const bugEntry = overview.find((o) => o.type === 'bug');
    assert.ok(bugEntry, 'bug entry should exist');
    assert.equal(bugEntry.count, 1);
    assert.equal(bugEntry.status, 'done');
    assert.ok(!('refinement' in bugEntry), 'refinement bucket should not be present');
    assert.ok(!('open' in bugEntry), 'open bucket should not be present');
  });

  test('status: "open" counts refinement+todo+in_progress only', async () => {
    store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Active', description: '', status: 'refinement' });
    const { id: doneId } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Done', description: '', status: 'refinement' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetOverview(store, { status: 'open' }, CTX);
    const { overview } = decode(resp) as { overview: { type: string; refinement: number; plan: number; done: number }[] };
    const bugEntry = overview.find((o) => o.type === 'bug');
    assert.ok(bugEntry);
    assert.equal(bugEntry.done, 0);
    assert.equal(bugEntry.refinement, 1);
  });

  test('status: "todo" counts only todo tasks — returns count shape, not three-bucket', async () => {
    store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Todo', description: '', summary: 'x', status: 'todo' });
    store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Refinement', description: '', status: 'refinement' });

    const resp = await handleGetOverview(store, { status: 'todo' }, CTX);
    const { overview } = decode(resp) as { overview: { type: string; count: number; status: string }[] };
    const bugEntry = overview.find((o) => o.type === 'bug');
    assert.ok(bugEntry);
    assert.equal(bugEntry.count, 1);
    assert.equal(bugEntry.status, 'todo');
    assert.ok(!('open' in bugEntry), 'open bucket should not be present');
    assert.ok(!('refinement' in bugEntry), 'refinement bucket should not be present');
  });
});

describe('health handler — ui field', () => {
  let savedCwd: string;
  let savedMode: string | undefined;

  beforeEach(() => {
    savedCwd = process.cwd();
    savedMode = process.env['TASK_UI_MODE'];
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    if (savedMode === undefined) delete process.env['TASK_UI_MODE'];
    else process.env['TASK_UI_MODE'] = savedMode;
  });

  test('reports ui: bundled over stdio', async () => {
    delete process.env['TASK_UI_MODE'];
    const resp = await handleHealth();
    assert.equal((decode(resp) as { ui: string }).ui, 'bundled');
  });

  test('a leftover TASK_UI_MODE value doesn\'t change it', async () => {
    process.env['TASK_UI_MODE'] = 'standalone';
    const resp = await handleHealth();
    assert.equal((decode(resp) as { ui: string }).ui, 'bundled');
  });
});

describe('health handler — config section env validation', () => {
  let savedCwd: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedCwd = process.cwd();
    savedEnv = Object.fromEntries(ENV_ORDER.map((k) => [k, process.env[k]]));
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  // The server's real env carries the canonical values; .mcp.json is only
  // scanned for legacy/unknown keys.
  function setEnv(env: Record<string, string>): void {
    for (const k of ENV_ORDER) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
  }

  function writeMcpJson(env: Record<string, string>): void {
    setEnv(env);
    const config = {
      mcpServers: {
        'task-manager': {
          command: 'node',
          args: ['/abs/path/dist/server.js'],
          env,
        },
      },
    };
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify(config, null, 2));
  }

  function getReport(resp: MCPContent): string {
    return (decode(resp) as { report: string }).report;
  }

  test('flags legacy TASK_UI_DISABLE as ✗ with hints', async () => {
    writeMcpJson({
      TASKS_DB: dbPath,
      PROJECT_NAME: 'demo',
      TASK_UI_PORT: '7374',
      TASK_UI_AUTO_OPEN_IN_BROWSER: '0',
      TASK_UI_DISABLE: '0',
    });
    const report = getReport(await handleHealth());
    assert.match(report, /✗ TASK_UI_DISABLE — removed: .*client mode/);
  });

  test('canonical env produces ✓ for all four canonical vars and no TASK_UI_MODE line', async () => {
    writeMcpJson({
      TASKS_DB: dbPath,
      PROJECT_NAME: 'demo',
      TASK_UI_PORT: '7374',
      TASK_UI_AUTO_OPEN_IN_BROWSER: '0',
    });
    const report = getReport(await handleHealth());
    assert.match(report, /✓ TASKS_DB = /);
    assert.match(report, /✓ PROJECT_NAME = demo/);
    assert.match(report, /✓ TASK_UI_PORT = 7374/);
    assert.match(report, /✓ TASK_UI_AUTO_OPEN_IN_BROWSER = 0/);
    assert.doesNotMatch(report, /TASK_UI_MODE/);
  });

  test('TASK_UI_MODE=bundled (written by every older install) is ⚠ obsolete, not ✗', async () => {
    writeMcpJson({ TASKS_DB: dbPath, PROJECT_NAME: 'demo', TASK_UI_PORT: '7374', TASK_UI_AUTO_OPEN_IN_BROWSER: '0', TASK_UI_MODE: 'bundled' });
    process.env['TASK_UI_MODE'] = 'bundled';
    try {
      const report = getReport(await handleHealth());
      assert.match(report, /⚠ TASK_UI_MODE = bundled — obsolete/);
      assert.doesNotMatch(report, /✗ TASK_UI_MODE/);
    } finally {
      delete process.env['TASK_UI_MODE'];
    }
  });

  test('any other TASK_UI_MODE in .mcp.json is ✗ with the client-mode hint', async () => {
    writeMcpJson({ TASKS_DB: dbPath, PROJECT_NAME: 'demo', TASK_UI_PORT: '7374', TASK_UI_AUTO_OPEN_IN_BROWSER: '0', TASK_UI_MODE: 'standalone' });
    const report = getReport(await handleHealth());
    assert.match(report, /✗ TASK_UI_MODE — removed: .*install\.ts --server on.*Connect a machine/);
  });

  test('unknown key produces ⚠ "unknown — not consumed by MCP"', async () => {
    writeMcpJson({
      TASKS_DB: dbPath,
      PROJECT_NAME: 'demo',
      TASK_UI_PORT: '7374',
      TASK_UI_AUTO_OPEN_IN_BROWSER: '0',
      FOO_BAR: '1',
    });
    const report = getReport(await handleHealth());
    assert.match(report, /⚠ FOO_BAR — unknown, not consumed by MCP/);
  });

  test('non-integer TASK_UI_PORT produces ✗', async () => {
    writeMcpJson({
      TASKS_DB: dbPath,
      PROJECT_NAME: 'demo',
      TASK_UI_PORT: 'abc',
      TASK_UI_AUTO_OPEN_IN_BROWSER: '0',
    });
    const report = getReport(await handleHealth());
    assert.match(report, /✗ TASK_UI_PORT = abc/);
  });

  test('without any .mcp.json (user/local-scope binding) the env still validates and nothing is ✗', async () => {
    setEnv({ TASKS_DB: dbPath, PROJECT_NAME: 'demo', TASK_UI_PORT: '7374', TASK_UI_AUTO_OPEN_IN_BROWSER: '0' });
    const report = getReport(await handleHealth());
    const config = report.split('\n\n').find((sec) => sec.includes('Config (env)\n'))!;
    assert.match(config, /✓ PROJECT_NAME = demo/);
    assert.doesNotMatch(config, /✗/);
    assert.doesNotMatch(report, /\.mcp\.json not found/);
  });

  test('a DB migrated past this build shows ✗ with the rebuild/restart hint; a current one names the last migration', async () => {
    setEnv({ TASKS_DB: dbPath, PROJECT_NAME: 'demo', TASK_UI_PORT: '7374', TASK_UI_AUTO_OPEN_IN_BROWSER: '0' });
    assert.match(getReport(await handleHealth()), /✓ DB schema up to date \(\d+ migrations, last \d+_[\w-]+ applied .+ UTC\)/);
    const other = new Database(dbPath);
    other.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(99, 'future-migration');
    other.close();
    assert.match(getReport(await handleHealth()), /✗ DB was migrated by a newer task-manager build \(future-migration\).*Rebuild/);
  });
});

describe('health handler — version section', () => {
  let savedCwd: string;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    savedCwd = process.cwd();
    process.chdir(dir);
    originalFetch = globalThis.fetch;
    resetUpdateCheckCache();
  });

  afterEach(() => {
    process.chdir(savedCwd);
    globalThis.fetch = originalFetch;
    resetUpdateCheckCache();
  });

  function writeMcpJson(env: Record<string, string>): void {
    const config = {
      mcpServers: {
        'task-manager': {
          command: 'node',
          args: ['/abs/path/dist/server.js'],
          env,
        },
      },
    };
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify(config, null, 2));
  }

  test('reports an update-available line with upgrade steps when the remote version is newer', async () => {
    writeMcpJson({
      TASKS_DB: dbPath,
      PROJECT_NAME: 'demo',
      TASK_UI_PORT: '7374',
      TASK_UI_AUTO_OPEN_IN_BROWSER: '0',
    });
    globalThis.fetch = (async () => ({
      ok: true,
      text: async () => `export const VERSION = '9999-12-999';\n`,
    })) as unknown as typeof fetch;

    const report = (decode(await handleHealth()) as { report: string }).report;
    assert.match(report, /⚠ Update available: v9999-12-999 \(local v.+\) — git -C .+ pull/);
  });

  test('reports an unknown-not-failed line when the remote check errors', async () => {
    writeMcpJson({
      TASKS_DB: dbPath,
      PROJECT_NAME: 'demo',
      TASK_UI_PORT: '7374',
      TASK_UI_AUTO_OPEN_IN_BROWSER: '0',
    });
    globalThis.fetch = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;

    const report = (decode(await handleHealth()) as { report: string }).report;
    assert.match(report, /⚠ Update check unavailable \(v.+\)/);
  });
});

describe('stdio server — legacy TASK_UI_MODE', () => {
  test('standalone/disabled refuse to start with the fix on stderr', () => {
    for (const mode of ['standalone', 'disabled']) {
      const r = spawnSync(process.execPath, ['--import', 'tsx', join(PACKAGE_DIR, 'server.ts')], {
        env: { ...process.env, TASK_UI_MODE: mode, TASKS_DB: dbPath },
        input: '',
        encoding: 'utf8',
        timeout: 20_000,
      });
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, new RegExp(`TASK_UI_MODE=${mode} is no longer supported`));
      assert.match(r.stderr, /Connect a machine/);
      assert.match(r.stderr, /install\.ts --server on/);
      assert.match(r.stderr, /delete TASK_UI_MODE/);
    }
  });
});

describe('getAll handler', () => {
  test('omits type key entirely when all tasks of that type are done', async () => {
    const { id } = addTask({ type: 'idea', title: 'An idea' });
    store.setStatus(id, 'done');
    addTask({ type: 'bug', title: 'Live bug' });

    const resp = await handleGetAll(store, {}, CTX);
    const { tasks } = decode(resp) as { tasks: Record<string, unknown[]> };
    assert.ok(!('idea' in tasks), 'idea key should be absent when all idea tasks are done');
    assert.ok('bug' in tasks);
  });

  test('returns empty grouped object when everything is done', async () => {
    const { id } = addTask({ type: 'bug' });
    store.setStatus(id, 'done');

    const resp = await handleGetAll(store, {}, CTX);
    const { tasks } = decode(resp);
    assert.deepEqual(tasks, {});
  });

  test('type and scope filters keep the grouped shape', async () => {
    const webBug = addTask({ type: 'bug', scope: 'web' }).id;
    addTask({ type: 'bug', scope: 'cli' });
    const webIdea = addTask({ type: 'idea', scope: 'web' }).id;
    const ids = async (args: { type?: 'bug'; scope?: string }) => {
      const { tasks } = decode(await handleGetAll(store, args, CTX)) as { tasks: Record<string, { id: number }[]> };
      return Object.fromEntries(Object.entries(tasks).map(([k, v]) => [k, v.map((t) => t.id)]));
    };
    assert.deepEqual(Object.keys(await ids({ type: 'bug' })), ['bug']);
    assert.deepEqual(await ids({ scope: 'web' }), { bug: [webBug], idea: [webIdea] });
    assert.deepEqual(await ids({ type: 'bug', scope: 'web' }), { bug: [webBug] });
    assert.deepEqual(await ids({ scope: 'nope' }), {});
  });
});

describe('note handlers', () => {
  test('addNote returns the note', () => {
    const { id } = addTask();
    const resp = handleAddNote(store, { taskId: id, body: 'decided X' });
    assert.equal(resp.isError, undefined);
    const body = decode(resp) as { success: boolean; note: { task_id: number; body: string } };
    assert.equal(body.success, true);
    assert.equal(body.note.task_id, id);
    assert.equal(body.note.body, 'decided X');
  });

  test('addNote on unknown task returns not-found', () => {
    const resp = handleAddNote(store, { taskId: 999, body: 'x' });
    assert.equal(resp.isError, true);
    assert.match(String(decode(resp)['error']), /Task #999 not found/);
  });

  test('empty body is rejected by addNote and updateNote', () => {
    const { id } = addTask();
    assert.equal(handleAddNote(store, { taskId: id, body: '  ' }).isError, true);
    const note = store.addNote(id, 'x')!;
    assert.equal(handleUpdateNote(store, { noteId: note.id, body: ' ' }).isError, true);
    assert.equal(store.getById(id)?.notes?.[0]?.body, 'x');
  });

  test('updateNote and deleteNote round-trip', () => {
    const { id } = addTask();
    const note = store.addNote(id, 'x')!;
    const upd = decode(handleUpdateNote(store, { noteId: note.id, body: 'y' })) as { note: { body: string } };
    assert.equal(upd.note.body, 'y');
    assert.deepEqual(decode(handleDeleteNote(store, { noteId: note.id })), { success: true });
    assert.equal(store.getById(id)?.notes, undefined);
  });

  test('unknown noteId returns a note-not-found error', () => {
    for (const resp of [handleUpdateNote(store, { noteId: 999, body: 'x' }), handleDeleteNote(store, { noteId: 999 })]) {
      assert.equal(resp.isError, true);
      assert.equal(decode(resp)['error'], 'Note #999 not found.');
    }
  });

  test('getById includes notes in order', async () => {
    const { id } = addTask();
    store.addNote(id, 'first');
    store.addNote(id, 'second');
    const task = decode(await handleGetById(store, { id }))['task'] as { notes: { body: string }[] };
    assert.deepEqual(task.notes.map((n) => n.body), ['first', 'second']);
  });

  test('getAll, filtered or not, shows noteCount without bodies', async () => {
    const { id } = addTask({ scope: 'area' });
    store.addNote(id, 'a');
    const all = decode(await handleGetAll(store, {}, CTX))['tasks'] as Record<string, Record<string, unknown>[]>;
    const scoped = decode(await handleGetAll(store, { scope: 'area' }, CTX))['tasks'] as Record<string, Record<string, unknown>[]>;
    for (const t of [all['bug']![0]!, scoped['bug']![0]!]) {
      assert.equal(t['noteCount'], 1);
      assert.equal('notes' in t, false);
    }
  });
});

describe('epics — MCP layer', () => {
  const epicId = (): number => addTask({ type: 'epic', title: 'Roadmap', description: 'Rules' }).id;

  test('add handler accepts parentId; getById handler returns epic and children', async () => {
    const epic = epicId();
    store.addNote(epic, 'ctx');
    const added = decode(handleAdd(store, { type: 'feature', priority: 'low', title: 'Kid', description: '', status: 'refinement', parentId: epic }, CTX));
    const kid = decode(await handleGetById(store, { id: added.id as number })).task as { epic: { id: number; description: string; notes: { body: string }[] } };
    assert.equal(kid.epic.id, epic);
    assert.equal(kid.epic.description, 'Rules');
    assert.equal(kid.epic.notes[0]?.body, 'ctx');
    const parent = decode(await handleGetById(store, { id: epic })).task as { children: { id: number }[] };
    assert.deepEqual(parent.children.map((c) => c.id), [added.id]);
  });

  test('handleUpdate returns an error (not a throw) on an invalid parent', () => {
    const { id } = addTask();
    const { id: plain } = addTask();
    const resp = handleUpdate(store, { id, parentId: plain });
    assert.ok(resp.isError);
    assert.match(decode(resp).error as string, /is not an epic/);
    assert.equal(store.getById(id)?.parentId, undefined);
  });

  test('handleUpdate with parentId: null detaches', () => {
    const epic = epicId();
    const { id } = addTask({ parentId: epic });
    const resp = handleUpdate(store, { id, parentId: null });
    assert.ok(!resp.isError);
    assert.equal(store.getById(id)?.parentId, undefined);
  });

  test('list handlers carry parentId and epicTitle and never epic or children', async () => {
    const epic = addTask({ type: 'epic', title: 'Roadmap', description: 'Rules', scope: 's' }).id;
    store.addNote(epic, 'ctx');
    const { id } = addTask({ parentId: epic, scope: 's' });
    store.update(id, { refs: [{ id: epic, relation: 'relates to' }] });

    type Row = { id: number; parentId?: number; epicTitle?: string; epic?: unknown; children?: unknown };
    const flat: Row[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        if ('id' in v && 'title' in v) flat.push(v as Row);
        else Object.values(v).forEach(walk);
      }
    };
    for (const args of [{}, { type: 'epic' as const }, { type: 'bug' as const }, { scope: 's' }]) walk(decode(await handleGetAll(store, args, CTX)));
    const related = decode(await handleGetRelated(store, { id: epic })) as { task: Row; inbound: Row[] };
    const rows = [
      ...flat,
      (decode(await handleGetNext(store, {}, CTX)).task as Row),
      related.task,
      ...related.inbound,
    ];
    const kids = rows.filter((r) => r.id === id);
    assert.ok(kids.length >= 5, 'child must show up in every list read');
    for (const r of kids) {
      assert.equal(r.parentId, epic);
      assert.equal(r.epicTitle, 'Roadmap');
    }
    for (const r of rows) {
      assert.equal(r.epic, undefined);
      assert.equal(r.children, undefined);
    }
  });

  test('getNext handler never returns an epic', async () => {
    epicId();
    assert.equal(decode(await handleGetNext(store, {}, CTX)).task ?? null, null);
    assert.equal(decode(await handleGetNext(store, { type: 'epic' }, CTX)).task ?? null, null);
  });

  describe('epic status sync', () => {
    test('first started child moves the epic to in_progress, once', () => {
      const epic = epicId();
      const { id: a } = addTask({ parentId: epic });
      const { id: b } = addTask({ parentId: epic });
      assert.match(decode(handleSetStatus(store, { id: a, status: 'in_progress' })).epicStatus as string, new RegExp(`Epic #${epic} \\(Roadmap\\) moved to in_progress`));
      assert.equal(store.getById(epic)?.status, 'in_progress');
      assert.equal(decode(handleSetStatus(store, { id: b, status: 'in_progress' })).epicStatus, undefined);
    });

    test('epic closes with its last child, not before', () => {
      const epic = epicId();
      const { id: a } = addTask({ parentId: epic });
      const { id: b } = addTask({ parentId: epic });
      assert.equal(decode(handleSetStatus(store, { id: a, status: 'done' })).epicStatus, undefined);
      assert.notEqual(store.getById(epic)?.status, 'done');
      assert.match(decode(handleSetStatus(store, { id: b, status: 'done' })).epicStatus as string, /moved to done/);
      assert.equal(store.getById(epic)?.status, 'done');
    });

    test('moving out or deleting the last open child closes the epic', () => {
      const epic = epicId();
      const { id: a } = addTask({ parentId: epic });
      const { id: b } = addTask({ parentId: epic });
      const { id: c } = addTask({ parentId: epic });
      store.setStatus(a, 'done');
      store.update(b, { parentId: null });
      assert.notEqual(store.getById(epic)?.status, 'done');
      store.delete(c);
      assert.equal(store.getById(epic)?.status, 'done');
    });

    test('re-setting a done child does not re-close a reopened epic', () => {
      const epic = epicId();
      const { id } = addTask({ parentId: epic });
      store.setStatus(id, 'done');
      store.setStatus(epic, 'in_progress');
      assert.equal(decode(handleSetStatus(store, { id, status: 'done' })).epicStatus, undefined);
      assert.equal(store.getById(epic)?.status, 'in_progress');
    });

    test('a child restarted on a done epic reopens it', () => {
      const epic = epicId();
      const { id } = addTask({ parentId: epic });
      handleSetStatus(store, { id, status: 'done' });
      assert.match(decode(handleSetStatus(store, { id, status: 'in_progress' })).epicStatus as string, /moved to in_progress/);
    });

    test('tasks without an epic and other transitions leave epics alone', () => {
      const epic = epicId();
      const { id: kid } = addTask({ parentId: epic });
      const { id: loose } = addTask();
      assert.equal(decode(handleSetStatus(store, { id: loose, status: 'in_progress' })).epicStatus, undefined);
      assert.equal(decode(handleSetStatus(store, { id: kid, status: 'todo' })).epicStatus, undefined);
      assert.equal(store.getById(epic)?.status, 'refinement');
    });
  });

  test('deleting an epic through the handler detaches its children', async () => {
    const epic = epicId();
    const { id } = addTask({ parentId: epic });
    handleDelete(store, { id: epic });
    const t = decode(await handleGetById(store, { id })).task as { parentId?: number; epic?: unknown };
    assert.equal(t.parentId, undefined);
    assert.equal(t.epic, undefined);
  });
});

// ── Instructions split + plugin rules hook ───────────────────────────────────

describe('reorder handler', () => {
  test('returns the children in execution order with their seq; getById(epic) matches', async () => {
    const epic = addTask({ type: 'epic', title: 'Example epic' }).id;
    const [a, b, c] = [1, 2, 3].map(() => addTask({ parentId: epic }).id) as [number, number, number];
    const resp = decode(handleReorder(store, { epicId: epic, order: [b, [a, c]] }));
    assert.deepEqual(resp, { success: true, epicId: epic, children: [{ id: b, seq: 10 }, { id: a, seq: 20 }, { id: c, seq: 20 }] });
    const kids = (decode(await handleGetById(store, { id: epic })) as { task: { children: { id: number; seq?: number }[] } }).task.children;
    assert.deepEqual(kids.map((k) => k.seq), [10, 20, 20]);
  });

  test('a foreign id is an error result and changes nothing', () => {
    const epic = addTask({ type: 'epic', title: 'Example epic' }).id;
    const a = addTask({ parentId: epic }).id;
    const stray = addTask().id;
    const resp = handleReorder(store, { epicId: epic, order: [a, stray] });
    assert.equal(resp.isError, true);
    assert.match(String(decode(resp)['error']), /not children of epic/);
    assert.equal(store.getById(a)?.seq, undefined);
  });

  test('add/update handlers reject seq without parentId', () => {
    const resp = handleAdd(store, { type: 'bug', priority: 'low', title: 'Loose', description: '', seq: 10 }, CTX);
    assert.equal(resp.isError, true);
    const { id } = addTask();
    assert.equal(handleUpdate(store, { id, seq: 10 }).isError, true);
  });
});

describe('externalId — MCP layer', () => {
  test('add with externalId is returned by getById', async () => {
    const { id } = decode(handleAdd(store, { type: 'feature', priority: 'low', title: 'T', description: '', externalId: 'OPXPIQ-6532' }, CTX)) as { id: number };
    const { task } = decode(await handleGetById(store, { id })) as { task: { externalId: string | null } };
    assert.equal(task.externalId, 'OPXPIQ-6532');
  });

  test('getAll items carry externalId: null when unset', async () => {
    addTask({ type: 'bug' });
    const { tasks } = decode(await handleGetAll(store, {}, CTX)) as { tasks: Record<string, Record<string, unknown>[]> };
    const t = tasks.bug?.[0];
    assert.ok(t && 'externalId' in t);
    assert.equal(t.externalId, null);
  });

  test('update clears externalId with null', () => {
    const { id } = addTask({ externalId: 'A-1' });
    assert.ok(!handleUpdate(store, { id, externalId: null }).isError);
    assert.equal(store.getById(id)?.externalId, null);
  });

  test('getByExternalId matches case-insensitively and returns [] on no match', async () => {
    const { id } = addTask({ externalId: 'OPXPIQ-6532' });
    const hit = decode(await handleGetByExternalId(store, { externalId: 'opxpiq-6532' })) as { externalId: string; tasks: { id: number }[] };
    assert.equal(hit.externalId, 'opxpiq-6532');
    assert.deepEqual(hit.tasks.map((t) => t.id), [id]);
    const miss = decode(await handleGetByExternalId(store, { externalId: 'NOPE-1' })) as { tasks: unknown[] };
    assert.deepEqual(miss.tasks, []);
  });
});

describe('getByPr handler', () => {
  test('returns the parsed pr and matching tasks, with a slim epic on children', async () => {
    const epic = addTask({ type: 'epic', title: 'Big' }).id;
    const { id } = addTask({ parentId: epic, prs: [{ url: 'https://github.com/Acme/Widgets/pull/9', number: 9, status: 'merged' }] });
    const r = decode(await handleGetByPr(store, { url: 'https://github.com/acme/widgets/pull/9/files' })) as {
      pr: unknown; tasks: { id: number; prs: unknown[]; epic?: { id: number; title: string }; plan?: string }[];
    };
    assert.deepEqual(r.pr, { host: 'github.com', repo: 'acme/widgets', number: 9 });
    assert.deepEqual(r.tasks.map((t) => t.id), [id]);
    assert.equal(r.tasks[0]?.prs.length, 1);
    assert.deepEqual(r.tasks[0]?.epic, { id: epic, title: 'Big', status: 'refinement' });
    const byRepo = decode(await handleGetByPr(store, { repo: 'Acme/Widgets', number: 9 })) as { pr: unknown; tasks: unknown[] };
    assert.deepEqual(byRepo.pr, { repo: 'acme/widgets', number: 9 });
    assert.equal(byRepo.tasks.length, 1);
  });

  test('no match gives an empty list; bad input is a tool error', async () => {
    const miss = decode(await handleGetByPr(store, { repo: 'a/b', number: 1 })) as { tasks: unknown[] };
    assert.deepEqual(miss.tasks, []);
    for (const args of [{ number: 1 }, { repo: 'a/b' }, { url: 'nope' }]) {
      const res = await handleGetByPr(store, args);
      assert.equal(res.isError, true);
      assert.match(JSON.stringify(decode(res)), /Validation failed/);
    }
  });
});

describe('parseSince', () => {
  test('ISO, SQLite datetime, and epoch seconds/ms all normalize to the same cursor', () => {
    const d = new Date('2026-01-02T03:04:05Z');
    const sqlite = '2026-01-02 03:04:05';
    assert.equal(parseSince('2026-01-02T03:04:05Z'), sqlite);
    assert.equal(parseSince(sqlite), sqlite);
    assert.equal(parseSince(Math.floor(d.getTime() / 1000)), sqlite);
    assert.equal(parseSince(String(Math.floor(d.getTime() / 1000))), sqlite);
    assert.equal(parseSince(d.getTime()), sqlite);
  });
});

describe('getUpdates handler', () => {
  function setUpdatedAt(id: number, ts: string): void {
    store.db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(ts, id);
  }

  test('since is inclusive at the boundary and tasks are sorted by updated_at then id', async () => {
    const a = addTask({ title: 'A' }).id;
    const b = addTask({ title: 'B' }).id;
    setUpdatedAt(a, '2026-01-01 00:00:00');
    setUpdatedAt(b, '2026-01-01 00:00:00');
    const resp = decode(await handleGetUpdates(store, { since: '2026-01-01 00:00:00' }, CTX)) as { asOf: string; tasks: { id: number }[] };
    assert.deepEqual(resp.tasks.map((t) => t.id), [a, b]);
    assert.match(resp.asOf, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('epicId returns the epic and its children; an unrelated task is excluded', async () => {
    const epic = addTask({ type: 'epic', title: 'Epic' }).id;
    const child = addTask({ type: 'feature', title: 'Child', parentId: epic }).id;
    addTask({ title: 'Other' });
    const resp = decode(await handleGetUpdates(store, { since: '2020-01-01 00:00:00', epicId: epic }, CTX)) as { tasks: { id: number }[] };
    assert.deepEqual(resp.tasks.map((t) => t.id).sort((x, y) => x - y), [epic, child].sort((x, y) => x - y));
  });

  test('a task moved to done is still reported', async () => {
    const { id } = addTask();
    setUpdatedAt(id, '2026-01-01 00:00:00');
    handleSetStatus(store, { id, status: 'done' });
    const resp = decode(await handleGetUpdates(store, { since: '2026-01-01 00:00:01' }, CTX)) as { tasks: { id: number; status: string }[] };
    assert.deepEqual(resp.tasks.map((t) => ({ id: t.id, status: t.status })), [{ id, status: 'done' }]);
  });

  test('only notes created or edited since the cursor are attached', async () => {
    const { id } = addTask();
    const old = store.addNote(id, 'old')!;
    store.db.prepare('UPDATE notes SET created_at = ?, updated_at = ? WHERE id = ?').run('2020-01-01 00:00:00', '2020-01-01 00:00:00', old.id);
    setUpdatedAt(id, '2020-01-01 00:00:00');
    store.addNote(id, 'new');
    const resp = decode(await handleGetUpdates(store, { since: '2025-01-01 00:00:00' }, CTX)) as { tasks: { id: number; notes?: { body: string }[] }[] };
    assert.equal(resp.tasks.length, 1);
    assert.deepEqual(resp.tasks[0]?.notes?.map((n) => n.body), ['new']);
  });

  test('a deleted requested id lands in missing; the field is omitted when nothing is missing', async () => {
    const { id: gone } = addTask();
    const { id: kept } = addTask();
    store.delete(gone);
    const since = '2020-01-01 00:00:00';
    const withMissing = decode(await handleGetUpdates(store, { since, ids: [gone, kept] }, CTX)) as { tasks: { id: number }[]; missing?: number[] };
    assert.deepEqual(withMissing.missing, [gone]);
    assert.deepEqual(withMissing.tasks.map((t) => t.id), [kept]);
    const noMissing = decode(await handleGetUpdates(store, { since, ids: [kept] }, CTX));
    assert.equal('missing' in noMissing, false);
  });

  test('an unparseable since is a tool error', async () => {
    const resp = await handleGetUpdates(store, { since: 'not-a-date' }, CTX);
    assert.equal(resp.isError, true);
    assert.match(String(decode(resp)['error']), /Validation failed/);
  });
});

const PLUGIN_DIR = join(PACKAGE_DIR, 'plugin');
const RULES = readFileSync(join(PLUGIN_DIR, 'RULES.md'), 'utf8');

describe('instructions size limits', () => {
  test('instructions fit the 4,096-char MCP server-instructions cap, with and without the PR rule', () => {
    for (const trackPrs of [false, true]) {
      const text = buildInstructions(trackPrs);
      assert.ok(text.length <= 4096, `instructions (trackPrs=${trackPrs}) are ${text.length} chars`);
    }
  });

  test('the PR rule appears only when the project tracks PRs', () => {
    assert.doesNotMatch(buildInstructions(false), /PR/);
    assert.match(buildInstructions(true), /This project tracks PRs/);
    assert.match(buildInstructions(true), /getByPr/);
  });

  test('plugin RULES.md fits the 10,000-char SessionStart hook cap', () => {
    assert.ok(RULES.length <= 10000, `RULES.md is ${RULES.length} chars`);
  });
});

describe('plugin SessionStart hook (session-rules.mjs)', () => {
  let projectDir: string;
  let home: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'stm-hook-'));
    home = mkdtempSync(join(tmpdir(), 'stm-hook-home-'));
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  function runHook(env: NodeJS.ProcessEnv = { CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_ROOT: PLUGIN_DIR }) {
    const { CLAUDE_PROJECT_DIR: _, CLAUDE_PLUGIN_ROOT: __, ...base } = process.env;
    return spawnSync(process.execPath, [join(PLUGIN_DIR, 'hooks', 'session-rules.mjs')], {
      // A tmp HOME keeps the real ~/.claude.json out of the test.
      env: { ...base, HOME: home, USERPROFILE: home, ...env },
      encoding: 'utf8',
    });
  }

  // Windows editors (Notepad, PowerShell 5 Set-Content -Encoding UTF8) write a BOM.
  test('prints RULES.md when .mcp.json starts with a UTF-8 BOM', () => {
    writeFileSync(join(projectDir, '.mcp.json'), '﻿' + JSON.stringify({ mcpServers: { 'task-manager': { command: 'node', args: [] } } }));
    const r = runHook();
    assert.equal(r.status, 0);
    assert.equal(r.stdout, RULES);
  });

  test('prints nothing when CLAUDE_PROJECT_DIR is unset', () => {
    const r = runHook({ CLAUDE_PLUGIN_ROOT: PLUGIN_DIR });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  test('prints RULES.md when .mcp.json has a task-manager entry', () => {
    writeFileSync(join(projectDir, '.mcp.json'), JSON.stringify({ mcpServers: { 'task-manager': { command: 'node', args: [] } } }));
    const r = runHook();
    assert.equal(r.status, 0);
    assert.equal(r.stdout, RULES);
  });

  test('prints nothing when .mcp.json has no task-manager entry', () => {
    writeFileSync(join(projectDir, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'node', args: [] } } }));
    const r = runHook();
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  test('prints nothing when .mcp.json is invalid JSON', () => {
    writeFileSync(join(projectDir, '.mcp.json'), '{ not json');
    const r = runHook();
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  test('prints nothing when there is no .mcp.json', () => {
    const r = runHook();
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  const tmEntry = { 'task-manager': { command: 'node', args: [] } };

  test('prints RULES.md for a user-scope binding in ~/.claude.json', () => {
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: tmEntry }));
    assert.equal(runHook().stdout, RULES);
  });

  test('prints RULES.md for a local-scope binding of this project in ~/.claude.json', () => {
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: { [projectDir]: { mcpServers: tmEntry } } }));
    assert.equal(runHook().stdout, RULES);
  });

  test('prints nothing for a local-scope binding of another project', () => {
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: { '/somewhere/else': { mcpServers: tmEntry } } }));
    assert.equal(runHook().stdout, '');
  });

  test('prints nothing and exits 0 when ~/.claude.json is malformed', () => {
    writeFileSync(join(home, '.claude.json'), '{ nope');
    const r = runHook();
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });
});

describe('prs', () => {
  const pr = { url: 'https://example.com/pr/7', number: 7, status: 'open' as const };

  test('add and update carry prs; the update echo and list reads include them', async () => {
    const { id } = decode(handleAdd(store, { type: 'bug', priority: 'low', title: 'A', description: '', status: 'todo', prs: [pr] }, CTX)) as { id: number };
    const echo = decode(handleUpdate(store, { id, prs: [{ ...pr, status: 'merged' }] })) as { task: { prs: unknown } };
    assert.deepEqual(echo.task.prs, [{ ...pr, status: 'merged' }]);
    const { tasks } = decode(await handleGetAll(store, {}, CTX)) as { tasks: Record<string, { prs?: unknown }[]> };
    assert.deepEqual(Object.values(tasks).flat()[0]?.prs, [{ ...pr, status: 'merged' }]);
  });

  test('an invalid PR is a tool error and writes nothing', () => {
    const { id } = addTask();
    const resp = handleUpdate(store, { id, prs: [{ ...pr, url: 'ftp://example.com/pr/7' }] });
    assert.equal(resp.isError, true);
    assert.match(String(decode(resp)['error']), /must be http\(s\)/);
    assert.equal(store.getById(id)?.prs, undefined);
  });

  test('prsSchema rejects an unknown status and a non-positive number', () => {
    assert.equal(prsSchema.safeParse([{ ...pr, status: 'declined' }]).success, false);
    assert.equal(prsSchema.safeParse([{ ...pr, number: 0 }]).success, false);
    assert.equal(prsSchema.safeParse([pr]).success, true);
  });
});

describe('project binding', () => {
  test('list handlers use the bound project', async () => {
    store.createProject('example-project');
    const mine = addTask({ status: 'todo' }).id;
    addTask({ project: 'example-project', status: 'todo' });
    const { task } = decode(await handleGetNext(store, {}, CTX)) as { task: { id: number } };
    assert.equal(task.id, mine);
    const { tasks } = decode(await handleGetAll(store, {}, CTX)) as { tasks: Record<string, { id: number }[]> };
    assert.deepEqual(Object.values(tasks).flat().map((t) => t.id), [mine]);
  });

  test('an explicit project arg overrides the bound project', async () => {
    store.createProject('example-project');
    addTask({ status: 'todo' });
    const theirs = addTask({ project: 'example-project', status: 'todo', scope: 'example-scope' }).id;
    const { task } = decode(await handleGetNext(store, { project: 'example-project' }, CTX)) as { task: { id: number } };
    assert.equal(task.id, theirs);
    const scopes = decode(await handleGetScopes(store, { project: 'example-project' }, CTX)) as { project: string; scopes: { scope: string }[] };
    assert.deepEqual(scopes, { project: 'example-project', scopes: [{ scope: 'example-scope', total: 1, open: 1 }] });
  });

  test('add files into the bound project, or the explicit one', () => {
    store.createProject('example-project');
    const a = decode(handleAdd(store, { type: 'bug', priority: 'low', title: 'A', description: '', status: 'refinement' }, CTX)) as { id: number };
    const b = decode(handleAdd(store, { type: 'bug', priority: 'low', title: 'B', description: '', status: 'refinement', project: 'example-project' }, CTX)) as { id: number };
    assert.equal(store.getById(a.id)?.project, 'default');
    assert.equal(store.getById(b.id)?.project, 'example-project');
  });

  test('an unknown explicit project returns an error with the create hint', async () => {
    const resp = await handleGetNext(store, { project: 'nope' }, CTX);
    assert.equal(resp.isError, true);
    assert.match(String(decode(resp)['error']), /^Project "nope" does not exist — create it with createProject/);
    assert.equal(handleAdd(store, { type: 'bug', priority: 'low', title: 'A', description: '', status: 'refinement', project: 'nope' }, CTX).isError, true);
    assert.equal(store.getProjects()[0]?.total, 0, 'nothing was filed');
  });

  test('an unknown bound project says it comes from PROJECT_NAME', async () => {
    const resp = await handleGetAll(store, {}, { project: 'unbound' });
    assert.equal(resp.isError, true);
    assert.match(resp.content[0]!.text, /bound project \(PROJECT_NAME\)/);
  });

  test('update moves a task and rejects an unknown project', () => {
    store.createProject('example-project');
    const { id } = addTask();
    assert.equal(handleUpdate(store, { id, project: 'nope' }).isError, true);
    handleUpdate(store, { id, project: 'example-project' });
    assert.equal(store.getById(id)?.project, 'example-project');
  });

  test('getById reaches tasks of other projects', async () => {
    store.createProject('example-project');
    const { id } = addTask({ project: 'example-project' });
    const { task } = decode(await handleGetById(store, { id })) as { task: { project: string } };
    assert.equal(task.project, 'example-project');
  });

  test('getProjects and createProject', async () => {
    assert.deepEqual(decode(handleCreateProject(store, { name: 'Example Project' })), { success: true, project: { id: 'example-project', name: 'Example Project' } });
    assert.equal(handleCreateProject(store, { name: 'Example-Project' }).isError, true);
    const out = decode(await handleGetProjects(store, CTX)) as { boundProject: string; projects: { id: string; name: string }[] };
    assert.equal(out.boundProject, 'default');
    assert.deepEqual(out.projects.map((p) => [p.id, p.name]), [['default', 'default'], ['example-project', 'Example Project']]);
  });

  test('updateProject toggles trackPrs and getProjects reports it', async () => {
    assert.deepEqual(decode(handleUpdateProject(store, { project: 'DEFAULT', trackPrs: true })), { success: true, project: { id: 'default', name: 'default', trackPrs: true } });
    const out = decode(await handleGetProjects(store, CTX)) as { projects: { name: string; trackPrs: boolean }[] };
    assert.deepEqual(out.projects.map((p) => [p.name, p.trackPrs]), [['default', true]]);
    assert.equal(handleUpdateProject(store, { project: 'nope', trackPrs: true }).isError, true);
  });

  test('health reports the bound project', async () => {
    const ok = decode(await handleHealth({ store, ctx: CTX })) as { report: string };
    assert.match(ok.report, /✓ Bound project = default \(exists\)/);
    assert.match(ok.report, /Transport = stdio/);
    assert.match(ok.report, /Config \(env\)\n/);
    const bad = decode(await handleHealth({ store, ctx: { project: 'unbound' } })) as { report: string };
    assert.match(bad.report, /✗ Bound project = unbound — does not exist/);
  });
});

describe('withSchemaCheck (DB migrated past this build mid-session)', () => {
  function migrateUnderneath(): void {
    const other = new Database(dbPath);
    other.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(99, 'future-migration');
    other.close();
  }

  test('passes results through untouched while the schema is current', async () => {
    addTask();
    const resp = await withSchemaCheck(store, () => handleGetAll(store, {}, CTX))();
    assert.equal(resp.content.length, 1);
  });

  test('a write returns the rebuild/restart error, even from a handler that does not catch', async () => {
    const { id } = addTask();
    migrateUnderneath();
    for (const call of [
      () => handleAdd(store, { project: 'default', title: 't', type: 'bug', priority: 'low' }, CTX),
      () => handleSetStatus(store, { id, status: 'done' }),
      () => handleDelete(store, { id }),
    ]) {
      const resp = await withSchemaCheck(store, call)();
      assert.equal(resp.isError, true);
      assert.match(resp.content[0]!.text, /future-migration.*Rebuild .* restart/);
    }
  });

  test('a read still answers and carries a restart warning', async () => {
    addTask();
    migrateUnderneath();
    const resp = await withSchemaCheck(store, () => handleGetAll(store, {}, CTX))();
    assert.notEqual(resp.isError, true);
    assert.equal(resp.content.length, 2);
    assert.match(resp.content[1]!.text, /^⚠ DB was migrated by a newer task-manager build \(future-migration\)/);
  });
});

describe('health handler — plugin section', () => {
  let home: string;
  let savedCwd: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'stm-home-'));
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
    savedCwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(home, { recursive: true, force: true });
  });

  async function pluginSection(): Promise<string> {
    const report = (decode(await handleHealth(undefined, { homeDir: home })) as { report: string }).report;
    return report.split('\n\n').find((sec) => sec.includes('Plugin\n'))!;
  }

  function install(enabled?: boolean, version: string = VERSION): void {
    writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { 'tm@dabalroman': [{ scope: 'user', version }] } }));
    if (enabled !== undefined) {
      writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'tm@dabalroman': enabled } }));
    }
  }

  test('a clean plugin install is all ✓', async () => {
    install(true);
    const section = await pluginSection();
    assert.match(section, /✓ tm@dabalroman installed/);
    assert.doesNotMatch(section, /✗/);
  });

  test('a missing plugin is ✗ with the install command', async () => {
    assert.match(await pluginSection(), /✗ tm plugin not installed — run: claude plugin marketplace add/);
  });

  test('a disabled plugin is ✗ with the enable command', async () => {
    install(false);
    assert.match(await pluginSection(), /✗ tm@dabalroman installed but disabled — run: claude plugin enable tm@dabalroman/);
  });

  test('a plugin left installed under its old name is ✗ with the uninstall command', async () => {
    writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
      'tm@dabalroman': [{ scope: 'user', version: VERSION }],
      'task-manager@dabalroman': [{ scope: 'user', version: VERSION }],
    } }));
    const section = await pluginSection();
    assert.match(section, /✓ tm@dabalroman installed/);
    assert.match(section, /✗ task-manager@dabalroman is the plugin's old name — run: claude plugin uninstall task-manager@dabalroman/);
  });

  test('old skill copies in ~/.claude/commands are ✗, each named', async () => {
    install(true);
    mkdirSync(join(home, '.claude', 'commands'));
    writeFileSync(join(home, '.claude', 'commands', 'implement.md'), 'old');
    writeFileSync(join(home, '.claude', 'commands', 'refine.md'), 'old');
    writeFileSync(join(home, '.claude', 'commands', 'unrelated.md'), 'mine');
    const section = await pluginSection();
    assert.match(section, /✗ Old skill copies shadow the plugin: .*refine\.md, .*implement\.md — delete them/);
    assert.doesNotMatch(section, /unrelated/);
  });

  test('a plugin at the server version is ✓', async () => {
    install(true);
    assert.match(await pluginSection(), new RegExp(`✓ Plugin v${VERSION} matches the server`));
  });

  test('an older plugin is ⚠ with the plugin update command', async () => {
    install(true, '2000-01-001');
    assert.match(await pluginSection(), /⚠ Plugin v2000-01-001 differs from the server v.* — run: claude plugin marketplace update dabalroman && claude plugin update tm@dabalroman, then \/reload-plugins/);
  });

  test('a sha-versioned install is ⚠ with the plugin update command', async () => {
    install(true, 'b99d82bac17f');
    assert.match(await pluginSection(), /⚠ Plugin vb99d82bac17f differs from the server .* claude plugin update tm@dabalroman/);
  });

  test('a newer plugin is ⚠ with the server update steps', async () => {
    install(true, '9999-12-999');
    assert.match(await pluginSection(), /⚠ Plugin v9999-12-999 is newer than the server .* git -C .* pull/);
  });

  test('a directory marketplace skips the version comparison', async () => {
    install(true, 'b99d82bac17f');
    writeFileSync(join(home, '.claude', 'plugins', 'known_marketplaces.json'),
      JSON.stringify({ dabalroman: { source: { source: 'directory', path: '/x' } } }));
    const section = await pluginSection();
    assert.match(section, /– Plugin version not compared: a directory marketplace/);
    assert.doesNotMatch(section, /⚠/);
  });

  test('a dangling SETUP.md import in ~/.claude/CLAUDE.md is ✗', async () => {
    install(true);
    writeFileSync(join(home, '.claude', 'CLAUDE.md'), '# mine\n@~/.claude/mcp-servers/simple-task-manager/SETUP.md\n');
    assert.match(await pluginSection(), /✗ ~\/\.claude\/CLAUDE\.md still imports @~\/\.claude\/mcp-servers\/simple-task-manager\/SETUP\.md/);
  });
});

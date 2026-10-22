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
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore, type AddInput, type Store } from './tasks.js';
import {
  handleGetByType,
  handleGetNext,
  handleGetAll,
  handleGetById,
  handleGetByScope,
  handleGetRelated,
  handleGetOverview,
  handleHealth,
} from './mcp/queryHandlers.js';
import {
  handleAdd,
  handleUpdate,
  handleReplace,
  handleUploadPlan,
  handleAddNote,
  handleUpdateNote,
  handleDeleteNote,
  handleSetStatus,
  handleDelete,
  handleUiStart,
  handleUiStop,
} from './mcp/mutationHandlers.js';
import type { MCPContent } from './mcp/shared.js';
import { isWithin } from './mcp/planPath.js';
import { resetUpdateCheckCache } from './updateCheck.js';

let dir: string;
let dbPath: string;
let store: Store;

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
    });
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
    });
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
    });
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
    });
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
    return store.add({ type: 'bug', priority: 'medium', title: 'T', description: 'Long desc.', summary: 'Short gist.', ...overrides });
  }

  test('getAll strips description when summary present', async () => {
    const { id } = addWithSummary({ status: 'todo' });
    const { tasks } = decode(await handleGetAll(store, {})) as { tasks: Record<string, { id: number; summary?: string; description?: string }[]> };
    const t = tasks.bug?.find((x) => x.id === id);
    assert.equal(t?.summary, 'Short gist.');
    assert.equal(t?.description, undefined);
  });

  test('getAll keeps description when no summary', async () => {
    const { id } = store.add({ type: 'bug', priority: 'medium', title: 'T', description: 'Long desc.', status: 'todo' });
    const { tasks } = decode(await handleGetAll(store, {})) as { tasks: Record<string, { id: number; summary?: string; description?: string }[]> };
    const t = tasks.bug?.find((x) => x.id === id);
    assert.equal(t?.description, 'Long desc.');
    assert.equal(t?.summary, undefined);
  });

  test('getByScope strips description when summary present', async () => {
    const { id } = addWithSummary({ scope: 'x' });
    const { tasks } = decode(await handleGetByScope(store, { scope: 'x' })) as { tasks: { id: number; summary?: string; description?: string }[] };
    const t = tasks.find((x) => x.id === id);
    assert.equal(t?.summary, 'Short gist.');
    assert.equal(t?.description, undefined);
  });

  test('getByType strips description when summary present', async () => {
    const { id } = addWithSummary({ type: 'feature' });
    const { tasks } = decode(await handleGetByType(store, { type: 'feature' })) as { tasks: { id: number; summary?: string; description?: string }[] };
    const t = tasks.find((x) => x.id === id);
    assert.equal(t?.summary, 'Short gist.');
    assert.equal(t?.description, undefined);
  });

  test('getNext strips description when summary present', async () => {
    addWithSummary({ type: 'bug', priority: 'high', status: 'todo' });
    const { task } = decode(await handleGetNext(store, {})) as { task: { summary?: string; description?: string } };
    assert.equal(task.summary, 'Short gist.');
    assert.equal(task.description, undefined);
  });

  test('getAll strips description when summary present', async () => {
    const { id } = addWithSummary({ type: 'bug' });
    const { tasks } = decode(await handleGetAll(store)) as { tasks: Record<string, { id: number; summary?: string; description?: string }[]> };
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
    const { id: b } = store.add({ type: 'bug', priority: 'medium', title: 'B', description: 'B desc.', summary: 'B gist.', refs: [{ id: a, relation: 'blocks' }] });
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

describe('uploadPlan handler', () => {
  function planFile(name: string, body: string): string {
    const p = join(dir, name);
    writeFileSync(p, body);
    return p;
  }

  test('stores file content as plan; ack has no plan/task; source file kept', () => {
    const { id } = addTask();
    const path = planFile('plan.md', '# Plan\n\nstep é');
    const resp = handleUploadPlan(store, { id, path });
    assert.ok(!resp.isError);
    assert.deepEqual(decode(resp), { success: true, id, bytes: Buffer.byteLength('# Plan\n\nstep é', 'utf8') });
    assert.equal(store.getById(id)?.plan, '# Plan\n\nstep é');
    assert.ok(existsSync(path));
  });

  test('re-upload replaces the plan', () => {
    const { id } = addTask();
    handleUploadPlan(store, { id, path: planFile('a.md', 'first') });
    handleUploadPlan(store, { id, path: planFile('b.md', 'second') });
    assert.equal(store.getById(id)?.plan, 'second');
  });

  test('relative path errors', () => {
    const { id } = addTask();
    const resp = handleUploadPlan(store, { id, path: 'plan.md' });
    assert.ok(resp.isError);
    assert.match(decode(resp).error as string, /absolute/);
  });

  test('non-.md errors; .MD accepted', () => {
    const { id } = addTask();
    const bad = handleUploadPlan(store, { id, path: planFile('plan.txt', 'x') });
    assert.ok(bad.isError);
    assert.match(decode(bad).error as string, /\.md/);
    const ok = handleUploadPlan(store, { id, path: planFile('PLAN.MD', 'x') });
    assert.ok(!ok.isError);
  });

  test('missing file errors and names the path', () => {
    const { id } = addTask();
    const path = join(dir, 'nope.md');
    const resp = handleUploadPlan(store, { id, path });
    assert.ok(resp.isError);
    assert.ok((decode(resp).error as string).includes(path));
  });

  test('whitespace-only file errors and leaves existing plan', () => {
    const { id } = addTask({ plan: 'keep me' });
    const resp = handleUploadPlan(store, { id, path: planFile('empty.md', ' \n\t') });
    assert.ok(resp.isError);
    assert.equal(store.getById(id)?.plan, 'keep me');
  });

  test('unknown id returns not-found error', () => {
    const resp = handleUploadPlan(store, { id: 9999, path: planFile('p.md', 'x') });
    assert.ok(resp.isError);
    assert.match(decode(resp).error as string, /not found/i);
  });
});

describe('uploadPlan path guard', () => {
  let outside: string;
  beforeEach(() => { outside = mkdtempSync(join(tmpdir(), 'stm-outside-')); });
  afterEach(() => { rmSync(outside, { recursive: true, force: true }); });

  test('file outside every allowed root is rejected', () => {
    const { id } = addTask();
    const path = join(outside, 'plan.md');
    writeFileSync(path, 'x');
    const resp = handleUploadPlan(store, { id, path }, [dir]);
    assert.ok(resp.isError);
    assert.match(decode(resp).error as string, /outside the allowed plan directories/);
    assert.equal(store.getById(id)?.plan, undefined);
  });

  test('.. segments that escape the root are rejected', () => {
    const { id } = addTask();
    writeFileSync(join(outside, 'plan.md'), 'x');
    const path = join(dir, '..', outside.split(/[\\/]/).pop()!, 'plan.md');
    const resp = handleUploadPlan(store, { id, path }, [dir]);
    assert.ok(resp.isError);
    assert.match(decode(resp).error as string, /outside/);
  });

  test('symlink inside a root pointing outside is rejected', (t) => {
    const { id } = addTask();
    const target = join(outside, 'secret.md');
    writeFileSync(target, 'x');
    const link = join(dir, 'link.md');
    try {
      symlinkSync(target, link);
    } catch {
      t.skip('symlinks need extra privileges on this platform');
      return;
    }
    const resp = handleUploadPlan(store, { id, path: link }, [dir]);
    assert.ok(resp.isError);
    assert.match(decode(resp).error as string, /outside/);
  });

  test('directory named *.md is rejected', () => {
    const { id } = addTask();
    const path = join(dir, 'folder.md');
    mkdirSync(path);
    const resp = handleUploadPlan(store, { id, path }, [dir]);
    assert.ok(resp.isError);
    assert.match(decode(resp).error as string, /not a regular file/);
  });

  test('file in a nested folder of a root is accepted', () => {
    const { id } = addTask();
    mkdirSync(join(dir, 'sub'));
    const path = join(dir, 'sub', 'plan.md');
    writeFileSync(path, 'nested');
    assert.ok(!handleUploadPlan(store, { id, path }, [dir]).isError);
    assert.equal(store.getById(id)?.plan, 'nested');
  });

  test('missing root is ignored, not an error', () => {
    const { id } = addTask();
    const path = join(dir, 'plan.md');
    writeFileSync(path, 'x');
    assert.ok(!handleUploadPlan(store, { id, path }, [join(outside, 'nope'), dir]).isError);
  });
});

describe('isWithin', () => {
  test('posix', () => {
    assert.equal(isWithin('/a/b', '/a/b/c.md', posix), true);
    assert.equal(isWithin('/a/b', '/a/b/..x.md', posix), true);
    assert.equal(isWithin('/a/b', '/a/bc/c.md', posix), false);
    assert.equal(isWithin('/a/b', '/a/c.md', posix), false);
    assert.equal(isWithin('/a/b', '/a/b', posix), false);
  });

  test('win32: case-insensitive, other drives and prefix siblings rejected', () => {
    assert.equal(isWithin('C:\\Users\\Me\\proj', 'c:\\users\\me\\PROJ\\plan.md', win32), true);
    assert.equal(isWithin('C:\\proj', 'D:\\proj\\plan.md', win32), false);
    assert.equal(isWithin('C:\\proj', 'C:\\projx\\plan.md', win32), false);
    assert.equal(isWithin('C:\\proj', 'C:\\proj\\..\\other\\plan.md', win32), false);
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
    });
    const { id } = decode(resp) as { id: number };
    const task = store.getById(id);
    assert.equal(task?.plan, '# My Plan\n\n- step 1');
  });

  test('getById returns plan intact', async () => {
    const { id } = store.add({ type: 'bug', priority: 'medium', title: 'T', description: '', plan: '## Plan\n\nDo the thing.' });
    const resp = await handleGetById(store, { id });
    const { task } = decode(resp) as { task: { plan?: string } };
    assert.equal(task.plan, '## Plan\n\nDo the thing.');
  });

  test('getAll strips plan from list responses', async () => {
    store.add({ type: 'bug', priority: 'medium', title: 'T', description: '', plan: 'secret plan', status: 'todo' });
    const { tasks } = decode(await handleGetAll(store, {})) as { tasks: Record<string, { plan?: string }[]> };
    const all = Object.values(tasks).flat();
    assert.ok(all.every((t) => t.plan === undefined), 'plan must not appear in getAll results');
  });

  test('getByScope strips plan from list responses', async () => {
    store.add({ type: 'bug', priority: 'medium', title: 'T', description: '', plan: 'secret plan', scope: 'myapp' });
    const { tasks } = decode(await handleGetByScope(store, { scope: 'myapp' })) as { tasks: { plan?: string }[] };
    assert.ok(tasks.every((t) => t.plan === undefined), 'plan must not appear in getByScope results');
  });

  test('getByType strips plan from list responses', async () => {
    store.add({ type: 'idea', priority: 'low', title: 'T', description: '', plan: 'secret plan' });
    const { tasks } = decode(await handleGetByType(store, { type: 'idea' })) as { tasks: { plan?: string }[] };
    assert.ok(tasks.every((t) => t.plan === undefined), 'plan must not appear in getByType results');
  });

  test('getNext strips plan from list response', async () => {
    store.add({ type: 'bug', priority: 'high', title: 'T', description: '', plan: 'secret plan', status: 'todo' });
    const { task } = decode(await handleGetNext(store, {})) as { task: { plan?: string } };
    assert.equal(task.plan, undefined, 'plan must not appear in getNext result');
  });

  test('getAll strips plan from list responses', async () => {
    store.add({ type: 'bug', priority: 'medium', title: 'T', description: '', plan: 'secret plan' });
    const { tasks } = decode(await handleGetAll(store)) as { tasks: Record<string, { plan?: string }[]> };
    const all = Object.values(tasks).flat();
    assert.ok(all.every((t) => t.plan === undefined), 'plan must not appear in getAll results');
  });

  test('getRelated strips plan and note bodies from the anchor and related tasks', async () => {
    const { id: a } = store.add({ type: 'bug', priority: 'medium', title: 'A', description: '', plan: 'plan A' });
    const { id: b } = store.add({ type: 'bug', priority: 'medium', title: 'B', description: '', plan: 'plan B', refs: [{ id: a, relation: 'blocks' }] });
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
    });
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

describe('getByType handler — status filter', () => {
  test('no status omits done tasks', async () => {
    addTask({ type: 'feature', title: 'Active feature', status: 'refinement' });
    const { id: doneId } = addTask({ type: 'feature', title: 'Done feature', status: 'refinement' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetByType(store, { type: 'feature' });
    const { tasks } = decode(resp) as { tasks: { status: string }[] };
    assert.ok(tasks.every((t) => t.status !== 'done'), 'done must not appear by default');
    assert.equal(tasks.length, 1);
  });

  test('status: "done" returns only done tasks', async () => {
    addTask({ type: 'feature', title: 'Active feature', status: 'refinement' });
    const { id: doneId } = addTask({ type: 'feature', title: 'Done feature', status: 'refinement' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetByType(store, { type: 'feature', status: 'done' });
    const { tasks } = decode(resp) as { tasks: { status: string; title: string }[] };
    assert.ok(tasks.every((t) => t.status === 'done'));
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.title, 'Done feature');
  });

  test('status: "open" returns refinement+todo+in_progress, not done', async () => {
    addTask({ type: 'feature', title: 'Active feature', status: 'refinement' });
    const { id: doneId } = addTask({ type: 'feature', title: 'Done feature', status: 'refinement' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetByType(store, { type: 'feature', status: 'open' });
    const { tasks } = decode(resp) as { tasks: { status: string }[] };
    assert.ok(tasks.every((t) => t.status !== 'done'));
    assert.equal(tasks.length, 1);
  });

  test('status: "todo" returns only todo tasks', async () => {
    store.add({ type: 'feature', priority: 'medium', title: 'Todo feature', description: '', summary: 'x', status: 'todo' });
    store.add({ type: 'feature', priority: 'medium', title: 'Refinement feature', description: '', status: 'refinement' });

    const resp = await handleGetByType(store, { type: 'feature', status: 'todo' });
    const { tasks } = decode(resp) as { tasks: { status: string }[] };
    assert.ok(tasks.every((t) => t.status === 'todo'));
    assert.equal(tasks.length, 1);
  });
});

describe('getByScope handler — status filter', () => {
  test('no status omits done tasks', async () => {
    store.add({ type: 'bug', priority: 'medium', title: 'Active', description: '', scope: 'myapp', status: 'refinement' });
    const { id: doneId } = store.add({ type: 'bug', priority: 'medium', title: 'Done', description: '', scope: 'myapp', status: 'refinement' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetByScope(store, { scope: 'myapp' });
    const { tasks } = decode(resp) as { tasks: { status: string }[] };
    assert.ok(tasks.every((t) => t.status !== 'done'));
    assert.equal(tasks.length, 1);
  });

  test('status: "done" returns only done tasks', async () => {
    store.add({ type: 'bug', priority: 'medium', title: 'Active', description: '', scope: 'myapp', status: 'refinement' });
    const { id: doneId } = store.add({ type: 'bug', priority: 'medium', title: 'Done', description: '', scope: 'myapp', status: 'refinement' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetByScope(store, { scope: 'myapp', status: 'done' });
    const { tasks } = decode(resp) as { tasks: { status: string; title: string }[] };
    assert.ok(tasks.every((t) => t.status === 'done'));
    assert.equal(tasks[0]?.title, 'Done');
  });

  test('status: "open" returns refinement+todo+in_progress, not done', async () => {
    store.add({ type: 'bug', priority: 'medium', title: 'Active', description: '', scope: 'myapp', status: 'refinement' });
    const { id: doneId } = store.add({ type: 'bug', priority: 'medium', title: 'Done', description: '', scope: 'myapp', status: 'refinement' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetByScope(store, { scope: 'myapp', status: 'open' });
    const { tasks } = decode(resp) as { tasks: { status: string }[] };
    assert.ok(tasks.every((t) => t.status !== 'done'));
    assert.equal(tasks.length, 1);
  });

  test('status: "todo" returns only todo tasks', async () => {
    store.add({ type: 'bug', priority: 'medium', title: 'Todo', description: '', summary: 'x', scope: 'myapp', status: 'todo' });
    store.add({ type: 'bug', priority: 'medium', title: 'Refinement', description: '', scope: 'myapp', status: 'refinement' });

    const resp = await handleGetByScope(store, { scope: 'myapp', status: 'todo' });
    const { tasks } = decode(resp) as { tasks: { status: string }[] };
    assert.ok(tasks.every((t) => t.status === 'todo'));
    assert.equal(tasks.length, 1);
  });
});

describe('getRelated handler — status filter', () => {
  test('no status omits done related tasks', async () => {
    const { id: a } = store.add({ type: 'bug', priority: 'medium', title: 'Anchor', description: '' });
    const { id: b } = store.add({ type: 'bug', priority: 'medium', title: 'Active ref', description: '', refs: [{ id: a, relation: 'blocks' }] });
    const { id: c } = store.add({ type: 'bug', priority: 'medium', title: 'Done ref', description: '', refs: [{ id: a, relation: 'blocks' }] });
    store.setStatus(c, 'done');

    const resp = await handleGetRelated(store, { id: a });
    const payload = decode(resp) as { inbound: { id: number }[] };
    const inboundIds = payload.inbound.map((t) => t.id);
    assert.ok(inboundIds.includes(b), 'active ref should appear');
    assert.ok(!inboundIds.includes(c), 'done ref should be filtered out by default');
  });

  test('status: "done" returns done related tasks', async () => {
    const { id: a } = store.add({ type: 'bug', priority: 'medium', title: 'Anchor', description: '' });
    const { id: c } = store.add({ type: 'bug', priority: 'medium', title: 'Done ref', description: '', refs: [{ id: a, relation: 'blocks' }] });
    store.setStatus(c, 'done');

    const resp = await handleGetRelated(store, { id: a, status: 'done' });
    const payload = decode(resp) as { inbound: { id: number }[] };
    const inboundIds = payload.inbound.map((t) => t.id);
    assert.ok(inboundIds.includes(c), 'done ref should appear when status=done');
  });

  test('status: "open" returns refinement+todo+in_progress, not done', async () => {
    const { id: a } = store.add({ type: 'bug', priority: 'medium', title: 'Anchor', description: '' });
    const { id: b } = store.add({ type: 'bug', priority: 'medium', title: 'Active ref', description: '', refs: [{ id: a, relation: 'blocks' }] });
    const { id: c } = store.add({ type: 'bug', priority: 'medium', title: 'Done ref', description: '', refs: [{ id: a, relation: 'blocks' }] });
    store.setStatus(c, 'done');

    const resp = await handleGetRelated(store, { id: a, status: 'open' });
    const payload = decode(resp) as { inbound: { id: number }[] };
    const inboundIds = payload.inbound.map((t) => t.id);
    assert.ok(inboundIds.includes(b));
    assert.ok(!inboundIds.includes(c));
  });

  test('status: "todo" returns only todo related tasks', async () => {
    const { id: a } = store.add({ type: 'bug', priority: 'medium', title: 'Anchor', description: '' });
    store.add({ type: 'bug', priority: 'medium', title: 'Refinement ref', description: '', refs: [{ id: a, relation: 'blocks' }] });
    const { id: c } = store.add({ type: 'bug', priority: 'medium', title: 'Todo ref', description: '', summary: 'x', refs: [{ id: a, relation: 'blocks' }] });
    store.setStatus(c, 'todo');

    const resp = await handleGetRelated(store, { id: a, status: 'todo' });
    const payload = decode(resp) as { inbound: { id: number; status: string }[] };
    assert.ok(payload.inbound.every((t) => t.status === 'todo'));
    assert.equal(payload.inbound.length, 1);
  });
});

describe('getOverview handler — status filter', () => {
  test('no status omits done tasks from counts', async () => {
    store.add({ type: 'bug', priority: 'medium', title: 'Active', description: '', status: 'refinement' });
    const { id: doneId } = store.add({ type: 'bug', priority: 'medium', title: 'Done', description: '', status: 'refinement' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetOverview(store, {});
    const { overview } = decode(resp) as { overview: { type: string; refinement: number; plan: number; open: number; done: number }[] };
    const bugEntry = overview.find((o) => o.type === 'bug');
    assert.ok(bugEntry, 'bug entry should exist');
    assert.equal(bugEntry.done, 0, 'done count should be 0 when filtering non-done');
    assert.equal(bugEntry.refinement, 1);
  });

  test('status: "done" shows only done tasks — returns count shape, not three-bucket', async () => {
    store.add({ type: 'bug', priority: 'medium', title: 'Active', description: '', status: 'refinement' });
    const { id: doneId } = store.add({ type: 'bug', priority: 'medium', title: 'Done', description: '', status: 'refinement' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetOverview(store, { status: 'done' });
    const { overview } = decode(resp) as { overview: { type: string; count: number; status: string }[] };
    const bugEntry = overview.find((o) => o.type === 'bug');
    assert.ok(bugEntry, 'bug entry should exist');
    assert.equal(bugEntry.count, 1);
    assert.equal(bugEntry.status, 'done');
    assert.ok(!('refinement' in bugEntry), 'refinement bucket should not be present');
    assert.ok(!('open' in bugEntry), 'open bucket should not be present');
  });

  test('status: "open" counts refinement+todo+in_progress only', async () => {
    store.add({ type: 'bug', priority: 'medium', title: 'Active', description: '', status: 'refinement' });
    const { id: doneId } = store.add({ type: 'bug', priority: 'medium', title: 'Done', description: '', status: 'refinement' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetOverview(store, { status: 'open' });
    const { overview } = decode(resp) as { overview: { type: string; refinement: number; plan: number; done: number }[] };
    const bugEntry = overview.find((o) => o.type === 'bug');
    assert.ok(bugEntry);
    assert.equal(bugEntry.done, 0);
    assert.equal(bugEntry.refinement, 1);
  });

  test('status: "todo" counts only todo tasks — returns count shape, not three-bucket', async () => {
    store.add({ type: 'bug', priority: 'medium', title: 'Todo', description: '', summary: 'x', status: 'todo' });
    store.add({ type: 'bug', priority: 'medium', title: 'Refinement', description: '', status: 'refinement' });

    const resp = await handleGetOverview(store, { status: 'todo' });
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
  let savedProjectName: string | undefined;

  beforeEach(() => {
    savedCwd = process.cwd();
    savedMode = process.env['TASK_UI_MODE'];
    savedProjectName = process.env['PROJECT_NAME'];
    // chdir into the fresh tmp dir (no .mcp.json there) so handleHealth takes
    // the early-return branch and `ui` comes from process.env.
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    if (savedMode === undefined) delete process.env['TASK_UI_MODE'];
    else process.env['TASK_UI_MODE'] = savedMode;
    if (savedProjectName === undefined) delete process.env['PROJECT_NAME'];
    else process.env['PROJECT_NAME'] = savedProjectName;
  });

  test('reports ui: standalone when TASK_UI_MODE=standalone', async () => {
    process.env['TASK_UI_MODE'] = 'standalone';
    const resp = await handleHealth();
    assert.equal((decode(resp) as { ui: string }).ui, 'standalone');
  });

  test('reports ui: disabled when TASK_UI_MODE=disabled', async () => {
    process.env['TASK_UI_MODE'] = 'disabled';
    const resp = await handleHealth();
    assert.equal((decode(resp) as { ui: string }).ui, 'disabled');
  });

  test('reports ui: bundled when TASK_UI_MODE=bundled', async () => {
    process.env['TASK_UI_MODE'] = 'bundled';
    const resp = await handleHealth();
    assert.equal((decode(resp) as { ui: string }).ui, 'bundled');
  });

  test('reports ui: bundled when TASK_UI_MODE is unset', async () => {
    delete process.env['TASK_UI_MODE'];
    const resp = await handleHealth();
    assert.equal((decode(resp) as { ui: string }).ui, 'bundled');
  });

  test('reports ui: bundled for an unrecognised TASK_UI_MODE value', async () => {
    process.env['TASK_UI_MODE'] = 'garbage';
    const resp = await handleHealth();
    assert.equal((decode(resp) as { ui: string }).ui, 'bundled');
  });
});

describe('health handler — config section env validation', () => {
  let savedCwd: string;

  beforeEach(() => {
    savedCwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(savedCwd);
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

  function getReport(resp: MCPContent): string {
    return (decode(resp) as { report: string }).report;
  }

  test('flags legacy TASK_UI_DISABLE and AUTO_OPEN_TASK_UI as ✗ with rename hints', async () => {
    writeMcpJson({
      TASKS_DB: dbPath,
      PROJECT_NAME: 'demo',
      TASK_UI_PORT: '7374',
      TASK_UI_MODE: 'bundled',
      TASK_UI_AUTO_OPEN_IN_BROWSER: '0',
      TASK_UI_DISABLE: '0',
      AUTO_OPEN_TASK_UI: '0',
    });
    const report = getReport(await handleHealth());
    assert.match(report, /✗ TASK_UI_DISABLE — renamed: set `TASK_UI_MODE=disabled` instead/);
    assert.match(report, /✗ AUTO_OPEN_TASK_UI — renamed to `TASK_UI_AUTO_OPEN_IN_BROWSER`/);
  });

  test('canonical .mcp.json produces ✓ for all five canonical vars', async () => {
    writeMcpJson({
      TASKS_DB: dbPath,
      PROJECT_NAME: 'demo',
      TASK_UI_PORT: '7374',
      TASK_UI_MODE: 'bundled',
      TASK_UI_AUTO_OPEN_IN_BROWSER: '0',
    });
    const report = getReport(await handleHealth());
    assert.match(report, /✓ TASKS_DB = /);
    assert.match(report, /✓ PROJECT_NAME = demo/);
    assert.match(report, /✓ TASK_UI_PORT = 7374/);
    assert.match(report, /✓ TASK_UI_MODE = bundled/);
    assert.match(report, /✓ TASK_UI_AUTO_OPEN_IN_BROWSER = 0/);
  });

  test('unknown key produces ⚠ "unknown — not consumed by MCP"', async () => {
    writeMcpJson({
      TASKS_DB: dbPath,
      PROJECT_NAME: 'demo',
      TASK_UI_PORT: '7374',
      TASK_UI_MODE: 'bundled',
      TASK_UI_AUTO_OPEN_IN_BROWSER: '0',
      FOO_BAR: '1',
    });
    const report = getReport(await handleHealth());
    assert.match(report, /⚠ FOO_BAR — unknown, not consumed by MCP/);
  });

  test('missing TASK_UI_MODE produces ⚠ "defaults to bundled"', async () => {
    writeMcpJson({
      TASKS_DB: dbPath,
      PROJECT_NAME: 'demo',
      TASK_UI_PORT: '7374',
      TASK_UI_AUTO_OPEN_IN_BROWSER: '0',
    });
    const report = getReport(await handleHealth());
    assert.match(report, /⚠ TASK_UI_MODE not set — defaults to "bundled"/);
  });

  test('non-integer TASK_UI_PORT produces ✗', async () => {
    writeMcpJson({
      TASKS_DB: dbPath,
      PROJECT_NAME: 'demo',
      TASK_UI_PORT: 'abc',
      TASK_UI_MODE: 'bundled',
      TASK_UI_AUTO_OPEN_IN_BROWSER: '0',
    });
    const report = getReport(await handleHealth());
    assert.match(report, /✗ TASK_UI_PORT = abc/);
  });

  test('health.ui structured field still resolves from .mcp.json env', async () => {
    writeMcpJson({
      TASKS_DB: dbPath,
      PROJECT_NAME: 'demo',
      TASK_UI_PORT: '7374',
      TASK_UI_MODE: 'standalone',
      TASK_UI_AUTO_OPEN_IN_BROWSER: '0',
    });
    const resp = await handleHealth();
    assert.equal((decode(resp) as { ui: string }).ui, 'standalone');
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
      TASK_UI_MODE: 'bundled',
      TASK_UI_AUTO_OPEN_IN_BROWSER: '0',
    });
    globalThis.fetch = (async () => ({
      ok: true,
      text: async () => `export const VERSION = '9999-12-999';\n`,
    })) as unknown as typeof fetch;

    const report = (decode(await handleHealth()) as { report: string }).report;
    assert.match(report, /⚠ Update available: v9999-12-999 \(local v.+\) — git pull in ~\/\.claude\/mcp-servers/);
  });

  test('reports an unknown-not-failed line when the remote check errors', async () => {
    writeMcpJson({
      TASKS_DB: dbPath,
      PROJECT_NAME: 'demo',
      TASK_UI_PORT: '7374',
      TASK_UI_MODE: 'bundled',
      TASK_UI_AUTO_OPEN_IN_BROWSER: '0',
    });
    globalThis.fetch = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;

    const report = (decode(await handleHealth()) as { report: string }).report;
    assert.match(report, /⚠ Update check unavailable \(v.+\)/);
  });
});

describe('ui-start / ui-stop — TASK_UI_MODE', () => {
  let savedMode: string | undefined;
  let savedProjectName: string | undefined;

  beforeEach(() => {
    savedMode = process.env['TASK_UI_MODE'];
    savedProjectName = process.env['PROJECT_NAME'];
  });

  afterEach(() => {
    if (savedMode === undefined) delete process.env['TASK_UI_MODE'];
    else process.env['TASK_UI_MODE'] = savedMode;
    if (savedProjectName === undefined) delete process.env['PROJECT_NAME'];
    else process.env['PROJECT_NAME'] = savedProjectName;
  });

  test('ui-start returns an error pointing to pm2 when mode=standalone', async () => {
    process.env['TASK_UI_MODE'] = 'standalone';
    process.env['PROJECT_NAME'] = 'my-project';
    const resp = await handleUiStart();
    assert.ok(resp.isError, 'should be an error');
    const msg = (decode(resp) as { error: string }).error;
    assert.ok(msg.includes('standalone'), 'error should mention standalone mode');
    assert.ok(msg.includes('pm2 restart my-project'), 'error should include the pm2 hint with the PROJECT_NAME');
  });

  test('ui-start returns an error explaining disabled when mode=disabled', async () => {
    process.env['TASK_UI_MODE'] = 'disabled';
    const resp = await handleUiStart();
    assert.ok(resp.isError, 'should be an error');
    const msg = (decode(resp) as { error: string }).error;
    assert.ok(msg.includes('disabled'));
    assert.ok(msg.includes('bundled'), 'error should point at the bundled value as the fix');
  });

  test('ui-stop returns an error pointing to pm2 when mode=standalone', async () => {
    process.env['TASK_UI_MODE'] = 'standalone';
    process.env['PROJECT_NAME'] = 'my-project';
    const resp = await handleUiStop();
    assert.ok(resp.isError, 'should be an error');
    const msg = (decode(resp) as { error: string }).error;
    assert.ok(msg.includes('standalone'));
    assert.ok(msg.includes('pm2 stop my-project'));
  });
});

describe('getAll handler', () => {
  test('excludes done tasks by default', async () => {
    addTask({ type: 'bug', title: 'Active bug' });
    const { id: doneId } = addTask({ type: 'bug', title: 'Resolved bug' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetAll(store, {});
    const { tasks } = decode(resp) as { tasks: Record<string, { status: string; title: string }[]> };
    const bugs = tasks.bug ?? [];
    assert.ok(bugs.every((t) => t.status !== 'done'), 'done tasks must not appear in getAll by default');
    assert.equal(bugs.length, 1);
    assert.equal(bugs[0]?.title, 'Active bug');
  });

  test('omits type key entirely when all tasks of that type are done', async () => {
    const { id } = addTask({ type: 'idea', title: 'An idea' });
    store.setStatus(id, 'done');
    addTask({ type: 'bug', title: 'Live bug' });

    const resp = await handleGetAll(store, {});
    const { tasks } = decode(resp) as { tasks: Record<string, unknown[]> };
    assert.ok(!('idea' in tasks), 'idea key should be absent when all idea tasks are done');
    assert.ok('bug' in tasks);
  });

  test('returns empty grouped object when everything is done', async () => {
    const { id } = addTask({ type: 'bug' });
    store.setStatus(id, 'done');

    const resp = await handleGetAll(store, {});
    const { tasks } = decode(resp);
    assert.deepEqual(tasks, {});
  });

  test('status: "done" returns only done tasks', async () => {
    addTask({ type: 'bug', title: 'Active bug' });
    const { id: doneId } = addTask({ type: 'bug', title: 'Resolved bug' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetAll(store, { status: 'done' });
    const { tasks } = decode(resp) as { tasks: Record<string, { status: string; title: string }[]> };
    const bugs = tasks.bug ?? [];
    assert.ok(bugs.every((t) => t.status === 'done'), 'only done tasks when status=done');
    assert.equal(bugs.length, 1);
    assert.equal(bugs[0]?.title, 'Resolved bug');
  });

  test('status: "open" returns refinement+todo+in_progress but not done', async () => {
    addTask({ type: 'bug', title: 'Refinement bug', status: 'refinement' });
    const { id: doneId } = addTask({ type: 'bug', title: 'Done bug' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetAll(store, { status: 'open' });
    const { tasks } = decode(resp) as { tasks: Record<string, { status: string }[]> };
    const bugs = tasks.bug ?? [];
    assert.ok(bugs.every((t) => t.status !== 'done'), 'done must not appear when status=open');
    assert.equal(bugs.length, 1);
  });

  test('status: "todo" returns only todo tasks', async () => {
    store.add({ type: 'bug', priority: 'medium', title: 'Todo bug', description: '', summary: 'x', status: 'todo' });
    store.add({ type: 'bug', priority: 'medium', title: 'Refinement bug', description: '', status: 'refinement' });

    const resp = await handleGetAll(store, { status: 'todo' });
    const { tasks } = decode(resp) as { tasks: Record<string, { status: string }[]> };
    const bugs = tasks.bug ?? [];
    assert.ok(bugs.every((t) => t.status === 'todo'), 'only todo tasks when status=todo');
    assert.equal(bugs.length, 1);
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

  test('getAll and getByScope show noteCount without bodies', async () => {
    const { id } = addTask({ scope: 'area' });
    store.addNote(id, 'a');
    const all = decode(await handleGetAll(store))['tasks'] as Record<string, Record<string, unknown>[]>;
    const scoped = decode(await handleGetByScope(store, { scope: 'area' }))['tasks'] as Record<string, unknown>[];
    for (const t of [all['bug']![0]!, scoped[0]!]) {
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
    const added = decode(handleAdd(store, { type: 'feature', priority: 'low', title: 'Kid', description: '', status: 'refinement', parentId: epic }));
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
    const epic = epicId();
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
    walk(decode(await handleGetAll(store, {})));
    const related = decode(await handleGetRelated(store, { id: epic })) as { task: Row; inbound: Row[] };
    const rows = [
      ...flat,
      ...(decode(await handleGetByType(store, { type: 'epic' })).tasks as Row[]),
      ...(decode(await handleGetByType(store, { type: 'bug' })).tasks as Row[]),
      ...(decode(await handleGetByScope(store, { scope: 's' })).tasks as Row[]),
      (decode(await handleGetNext(store, {})).task as Row),
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
    assert.equal(decode(await handleGetNext(store, {})).task ?? null, null);
    assert.equal(decode(await handleGetNext(store, { type: 'epic' })).task ?? null, null);
  });

  describe('epicReminder', () => {
    test('absent while siblings are open, present on the last child', () => {
      const epic = epicId();
      const { id: a } = addTask({ parentId: epic });
      const { id: b } = addTask({ parentId: epic });
      assert.equal(decode(handleSetStatus(store, { id: a, status: 'done' })).epicReminder, undefined);
      const last = decode(handleSetStatus(store, { id: b, status: 'done' }));
      assert.match(last.epicReminder as string, new RegExp(`epic #${epic} \\(Roadmap\\)`));
      assert.match(last.epicReminder as string, /do not close it yourself/);
      assert.equal(store.getById(epic)?.status, 'refinement', 'the epic must not be closed by the handler');
    });

    test('absent when the epic is already done', () => {
      const epic = epicId();
      const { id } = addTask({ parentId: epic });
      store.setStatus(epic, 'done');
      assert.equal(decode(handleSetStatus(store, { id, status: 'done' })).epicReminder, undefined);
    });

    test('absent for a task without an epic and for non-done transitions', () => {
      const epic = epicId();
      const { id: kid } = addTask({ parentId: epic });
      const { id: loose } = addTask();
      assert.equal(decode(handleSetStatus(store, { id: loose, status: 'done' })).epicReminder, undefined);
      assert.equal(decode(handleSetStatus(store, { id: kid, status: 'todo' })).epicReminder, undefined);
    });

    test('not repeated when an already-done last child is set to done again', () => {
      const epic = epicId();
      const { id } = addTask({ parentId: epic });
      assert.ok(decode(handleSetStatus(store, { id, status: 'done' })).epicReminder);
      assert.equal(decode(handleSetStatus(store, { id, status: 'done' })).epicReminder, undefined);
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

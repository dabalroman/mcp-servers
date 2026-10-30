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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, posix, win32 } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore, type AddInput, type Store } from './tasks.js';
import { INSTRUCTIONS } from './instructions.js';
import { PACKAGE_DIR } from './packageDir.js';
import { ENV_ORDER } from './mcpConfig.js';
import {
  handleGetByType,
  handleGetNext,
  handleGetAll,
  handleGetById,
  handleGetByScope,
  handleGetByExternalId,
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
  handleUploadPlan,
  handleAddNote,
  handleUpdateNote,
  handleDeleteNote,
  handleSetStatus,
  handleDelete,
  handleCreateProject,
} from './mcp/mutationHandlers.js';
import { withSchemaCheck, type MCPContent } from './mcp/shared.js';
import Database from 'better-sqlite3';
import { isWithin } from './mcp/planPath.js';
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

  test('getByScope strips description when summary present', async () => {
    const { id } = addWithSummary({ scope: 'x' });
    const { tasks } = decode(await handleGetByScope(store, { scope: 'x' }, CTX)) as { tasks: { id: number; summary?: string; description?: string }[] };
    const t = tasks.find((x) => x.id === id);
    assert.equal(t?.summary, 'Short gist.');
    assert.equal(t?.description, undefined);
  });

  test('getByType strips description when summary present', async () => {
    const { id } = addWithSummary({ type: 'feature' });
    const { tasks } = decode(await handleGetByType(store, { type: 'feature' }, CTX)) as { tasks: { id: number; summary?: string; description?: string }[] };
    const t = tasks.find((x) => x.id === id);
    assert.equal(t?.summary, 'Short gist.');
    assert.equal(t?.description, undefined);
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

  test('getByScope strips plan from list responses', async () => {
    store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'T', description: '', plan: 'secret plan', scope: 'myapp' });
    const { tasks } = decode(await handleGetByScope(store, { scope: 'myapp' }, CTX)) as { tasks: { plan?: string }[] };
    assert.ok(tasks.every((t) => t.plan === undefined), 'plan must not appear in getByScope results');
  });

  test('getByType strips plan from list responses', async () => {
    store.add({ project: 'default', type: 'idea', priority: 'low', title: 'T', description: '', plan: 'secret plan' });
    const { tasks } = decode(await handleGetByType(store, { type: 'idea' }, CTX)) as { tasks: { plan?: string }[] };
    assert.ok(tasks.every((t) => t.plan === undefined), 'plan must not appear in getByType results');
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

describe('getByType handler — status filter', () => {
  test('no status omits done tasks', async () => {
    addTask({ type: 'feature', title: 'Active feature', status: 'refinement' });
    const { id: doneId } = addTask({ type: 'feature', title: 'Done feature', status: 'refinement' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetByType(store, { type: 'feature' }, CTX);
    const { tasks } = decode(resp) as { tasks: { status: string }[] };
    assert.ok(tasks.every((t) => t.status !== 'done'), 'done must not appear by default');
    assert.equal(tasks.length, 1);
  });

  test('status: "done" returns only done tasks', async () => {
    addTask({ type: 'feature', title: 'Active feature', status: 'refinement' });
    const { id: doneId } = addTask({ type: 'feature', title: 'Done feature', status: 'refinement' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetByType(store, { type: 'feature', status: 'done' }, CTX);
    const { tasks } = decode(resp) as { tasks: { status: string; title: string }[] };
    assert.ok(tasks.every((t) => t.status === 'done'));
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.title, 'Done feature');
  });

  test('status: "open" returns refinement+todo+in_progress, not done', async () => {
    addTask({ type: 'feature', title: 'Active feature', status: 'refinement' });
    const { id: doneId } = addTask({ type: 'feature', title: 'Done feature', status: 'refinement' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetByType(store, { type: 'feature', status: 'open' }, CTX);
    const { tasks } = decode(resp) as { tasks: { status: string }[] };
    assert.ok(tasks.every((t) => t.status !== 'done'));
    assert.equal(tasks.length, 1);
  });

  test('status: "todo" returns only todo tasks', async () => {
    store.add({ project: 'default', type: 'feature', priority: 'medium', title: 'Todo feature', description: '', summary: 'x', status: 'todo' });
    store.add({ project: 'default', type: 'feature', priority: 'medium', title: 'Refinement feature', description: '', status: 'refinement' });

    const resp = await handleGetByType(store, { type: 'feature', status: 'todo' }, CTX);
    const { tasks } = decode(resp) as { tasks: { status: string }[] };
    assert.ok(tasks.every((t) => t.status === 'todo'));
    assert.equal(tasks.length, 1);
  });
});

describe('getByScope handler — status filter', () => {
  test('no status omits done tasks', async () => {
    store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Active', description: '', scope: 'myapp', status: 'refinement' });
    const { id: doneId } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Done', description: '', scope: 'myapp', status: 'refinement' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetByScope(store, { scope: 'myapp' }, CTX);
    const { tasks } = decode(resp) as { tasks: { status: string }[] };
    assert.ok(tasks.every((t) => t.status !== 'done'));
    assert.equal(tasks.length, 1);
  });

  test('status: "done" returns only done tasks', async () => {
    store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Active', description: '', scope: 'myapp', status: 'refinement' });
    const { id: doneId } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Done', description: '', scope: 'myapp', status: 'refinement' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetByScope(store, { scope: 'myapp', status: 'done' }, CTX);
    const { tasks } = decode(resp) as { tasks: { status: string; title: string }[] };
    assert.ok(tasks.every((t) => t.status === 'done'));
    assert.equal(tasks[0]?.title, 'Done');
  });

  test('status: "open" returns refinement+todo+in_progress, not done', async () => {
    store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Active', description: '', scope: 'myapp', status: 'refinement' });
    const { id: doneId } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Done', description: '', scope: 'myapp', status: 'refinement' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetByScope(store, { scope: 'myapp', status: 'open' }, CTX);
    const { tasks } = decode(resp) as { tasks: { status: string }[] };
    assert.ok(tasks.every((t) => t.status !== 'done'));
    assert.equal(tasks.length, 1);
  });

  test('status: "todo" returns only todo tasks', async () => {
    store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Todo', description: '', summary: 'x', scope: 'myapp', status: 'todo' });
    store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Refinement', description: '', scope: 'myapp', status: 'refinement' });

    const resp = await handleGetByScope(store, { scope: 'myapp', status: 'todo' }, CTX);
    const { tasks } = decode(resp) as { tasks: { status: string }[] };
    assert.ok(tasks.every((t) => t.status === 'todo'));
    assert.equal(tasks.length, 1);
  });
});

describe('getRelated handler — status filter', () => {
  test('no status omits done related tasks', async () => {
    const { id: a } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Anchor', description: '' });
    const { id: b } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Active ref', description: '', refs: [{ id: a, relation: 'blocks' }] });
    const { id: c } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Done ref', description: '', refs: [{ id: a, relation: 'blocks' }] });
    store.setStatus(c, 'done');

    const resp = await handleGetRelated(store, { id: a });
    const payload = decode(resp) as { inbound: { id: number }[] };
    const inboundIds = payload.inbound.map((t) => t.id);
    assert.ok(inboundIds.includes(b), 'active ref should appear');
    assert.ok(!inboundIds.includes(c), 'done ref should be filtered out by default');
  });

  test('status: "done" returns done related tasks', async () => {
    const { id: a } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Anchor', description: '' });
    const { id: c } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Done ref', description: '', refs: [{ id: a, relation: 'blocks' }] });
    store.setStatus(c, 'done');

    const resp = await handleGetRelated(store, { id: a, status: 'done' });
    const payload = decode(resp) as { inbound: { id: number }[] };
    const inboundIds = payload.inbound.map((t) => t.id);
    assert.ok(inboundIds.includes(c), 'done ref should appear when status=done');
  });

  test('status: "open" returns refinement+todo+in_progress, not done', async () => {
    const { id: a } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Anchor', description: '' });
    const { id: b } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Active ref', description: '', refs: [{ id: a, relation: 'blocks' }] });
    const { id: c } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Done ref', description: '', refs: [{ id: a, relation: 'blocks' }] });
    store.setStatus(c, 'done');

    const resp = await handleGetRelated(store, { id: a, status: 'open' });
    const payload = decode(resp) as { inbound: { id: number }[] };
    const inboundIds = payload.inbound.map((t) => t.id);
    assert.ok(inboundIds.includes(b));
    assert.ok(!inboundIds.includes(c));
  });

  test('status: "todo" returns only todo related tasks', async () => {
    const { id: a } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Anchor', description: '' });
    store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Refinement ref', description: '', refs: [{ id: a, relation: 'blocks' }] });
    const { id: c } = store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Todo ref', description: '', summary: 'x', refs: [{ id: a, relation: 'blocks' }] });
    store.setStatus(c, 'todo');

    const resp = await handleGetRelated(store, { id: a, status: 'todo' });
    const payload = decode(resp) as { inbound: { id: number; status: string }[] };
    assert.ok(payload.inbound.every((t) => t.status === 'todo'));
    assert.equal(payload.inbound.length, 1);
  });
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

  test('flags legacy TASK_UI_DISABLE and AUTO_OPEN_TASK_UI as ✗ with hints', async () => {
    writeMcpJson({
      TASKS_DB: dbPath,
      PROJECT_NAME: 'demo',
      TASK_UI_PORT: '7374',
      TASK_UI_AUTO_OPEN_IN_BROWSER: '0',
      TASK_UI_DISABLE: '0',
      AUTO_OPEN_TASK_UI: '0',
    });
    const report = getReport(await handleHealth());
    assert.match(report, /✗ TASK_UI_DISABLE — removed: .*client mode/);
    assert.match(report, /✗ AUTO_OPEN_TASK_UI — renamed to `TASK_UI_AUTO_OPEN_IN_BROWSER`/);
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
  test('excludes done tasks by default', async () => {
    addTask({ type: 'bug', title: 'Active bug' });
    const { id: doneId } = addTask({ type: 'bug', title: 'Resolved bug' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetAll(store, {}, CTX);
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

  test('status: "done" returns only done tasks', async () => {
    addTask({ type: 'bug', title: 'Active bug' });
    const { id: doneId } = addTask({ type: 'bug', title: 'Resolved bug' });
    store.setStatus(doneId, 'done');

    const resp = await handleGetAll(store, { status: 'done' }, CTX);
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

    const resp = await handleGetAll(store, { status: 'open' }, CTX);
    const { tasks } = decode(resp) as { tasks: Record<string, { status: string }[]> };
    const bugs = tasks.bug ?? [];
    assert.ok(bugs.every((t) => t.status !== 'done'), 'done must not appear when status=open');
    assert.equal(bugs.length, 1);
  });

  test('status: "todo" returns only todo tasks', async () => {
    store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Todo bug', description: '', summary: 'x', status: 'todo' });
    store.add({ project: 'default', type: 'bug', priority: 'medium', title: 'Refinement bug', description: '', status: 'refinement' });

    const resp = await handleGetAll(store, { status: 'todo' }, CTX);
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
    const all = decode(await handleGetAll(store, {}, CTX))['tasks'] as Record<string, Record<string, unknown>[]>;
    const scoped = decode(await handleGetByScope(store, { scope: 'area' }, CTX))['tasks'] as Record<string, unknown>[];
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
    walk(decode(await handleGetAll(store, {}, CTX)));
    const related = decode(await handleGetRelated(store, { id: epic })) as { task: Row; inbound: Row[] };
    const rows = [
      ...flat,
      ...(decode(await handleGetByType(store, { type: 'epic' }, CTX)).tasks as Row[]),
      ...(decode(await handleGetByType(store, { type: 'bug' }, CTX)).tasks as Row[]),
      ...(decode(await handleGetByScope(store, { scope: 's' }, CTX)).tasks as Row[]),
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

const PLUGIN_DIR = join(PACKAGE_DIR, 'plugin');
const RULES = readFileSync(join(PLUGIN_DIR, 'RULES.md'), 'utf8');

describe('instructions size limits', () => {
  test('INSTRUCTIONS fits the 4,096-char MCP server-instructions cap', () => {
    assert.ok(INSTRUCTIONS.length <= 4096, `INSTRUCTIONS is ${INSTRUCTIONS.length} chars`);
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
    assert.deepEqual(decode(handleCreateProject(store, { name: 'example-project' })), { success: true, project: { name: 'example-project' } });
    assert.equal(handleCreateProject(store, { name: 'Example-Project' }).isError, true);
    const out = decode(await handleGetProjects(store, CTX)) as { boundProject: string; projects: { name: string }[] };
    assert.equal(out.boundProject, 'default');
    assert.deepEqual(out.projects.map((p) => p.name), ['default', 'example-project']);
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
      JSON.stringify({ version: 2, plugins: { 'task-manager@dabalroman': [{ scope: 'user', version }] } }));
    if (enabled !== undefined) {
      writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'task-manager@dabalroman': enabled } }));
    }
  }

  test('a clean plugin install is all ✓', async () => {
    install(true);
    const section = await pluginSection();
    assert.match(section, /✓ task-manager@dabalroman installed/);
    assert.doesNotMatch(section, /✗/);
  });

  test('a missing plugin is ✗ with the install command', async () => {
    assert.match(await pluginSection(), /✗ task-manager plugin not installed — run: claude plugin marketplace add/);
  });

  test('a disabled plugin is ✗ with the enable command', async () => {
    install(false);
    assert.match(await pluginSection(), /✗ task-manager@dabalroman installed but disabled — run: claude plugin enable task-manager@dabalroman/);
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
    assert.match(await pluginSection(), /⚠ Plugin v2000-01-001 differs from the server v.* — run: claude plugin marketplace update dabalroman && claude plugin update task-manager@dabalroman, then \/reload-plugins/);
  });

  test('a sha-versioned install is ⚠ with the plugin update command', async () => {
    install(true, 'b99d82bac17f');
    assert.match(await pluginSection(), /⚠ Plugin vb99d82bac17f differs from the server .* claude plugin update task-manager@dabalroman/);
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

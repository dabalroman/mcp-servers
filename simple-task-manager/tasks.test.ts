import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import {
  createStore,
  sortByPriority,
  sortForNext,
  resolveStatusFilter,
  RELATIONS,
  type AddInput,
  type Store,
} from './tasks.js';

const MIGRATION_NAMES = [
  '20260101000000_initial-schema',
  '20260513000000_normalize-literal-newlines',
  '20260513000001_refs-pk-simplify',
  '20260514120000_add-plan-field',
  '20260519000000_drop-meta-counter-autoincrement-tasks',
  '20260519010000_add-plan-status',
];

let dir: string;
let dbPath: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-test-'));
  dbPath = join(dir, 'tasks.db');
  store = createStore(dbPath);
});

afterEach(() => {
  try { store.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

function makeTask(overrides: Partial<AddInput> = {}): { id: number } {
  return store.add({
    type: 'bug',
    priority: 'medium',
    title: 'Test',
    description: '',
    ...overrides,
  });
}

describe('schema', () => {
  test('creates tasks.db on first open', () => {
    assert.ok(existsSync(dbPath));
  });

  test('sets PRAGMA user_version to the number of applied migrations', () => {
    const db = new Database(dbPath);
    assert.equal(db.pragma('user_version', { simple: true }), MIGRATION_NAMES.length);
    db.close();
  });

  test('records all migrations in schema_migrations', () => {
    const db = new Database(dbPath);
    const rows = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as { version: number; name: string }[];
    assert.equal(rows.length, MIGRATION_NAMES.length);
    for (let i = 0; i < MIGRATION_NAMES.length; i++) {
      assert.equal(rows[i]?.version, i + 1);
      assert.equal(rows[i]?.name, MIGRATION_NAMES[i]);
    }
    db.close();
  });

  test('load returns empty active and done on fresh store', () => {
    const { active, done } = store.load();
    assert.equal(active.length, 0);
    assert.equal(done.length, 0);
  });

  test('uses DELETE journal mode (not WAL) for cross-namespace coherence', () => {
    const db = new Database(dbPath);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'delete');
    db.close();
  });

  test('sets busy_timeout=5000 so concurrent writers wait instead of SQLITE_BUSY', () => {
    assert.equal(store.db.pragma('busy_timeout', { simple: true }), 5000);
  });

  test('refuses to open a db that has unknown applied migrations (downgrade guard)', () => {
    store.close();
    const db = new Database(dbPath);
    db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(99, 'future-migration');
    db.close();
    assert.throws(() => createStore(dbPath), /downgrade not supported/);
  });

  test('migrations are idempotent — re-opening does not re-run', () => {
    store.close();
    const reopened = createStore(dbPath);
    const db = new Database(dbPath);
    const rows = db.prepare('SELECT * FROM schema_migrations').all();
    assert.equal(rows.length, MIGRATION_NAMES.length);
    db.close();
    reopened.close();
  });
});

describe('add', () => {
  test('returns id 1 for the first task', () => {
    const { id } = makeTask();
    assert.equal(id, 1);
  });

  test('increments id for sequential adds', () => {
    const { id: id1 } = makeTask({ title: 'A' });
    const { id: id2 } = makeTask({ title: 'B' });
    assert.equal(id2, id1 + 1);
  });

  test('survives external writer inserting a task with a higher id (no UNIQUE collision)', () => {
    const { id: id1 } = makeTask({ title: 'A' });
    assert.equal(id1, 1);
    store.close();

    // Simulate an external writer (backup restore, direct sqlite3, etc.) bumping max(id).
    const db = new Database(dbPath);
    db.prepare(`
      INSERT INTO tasks (id, type, status, priority, title, description, created_at, updated_at)
      VALUES (9999, 'other', 'refinement', 'medium', 'external', '', datetime('now'), datetime('now'))
    `).run();
    db.close();

    store = createStore(dbPath);
    const { id: nextId } = makeTask({ title: 'after external' });
    assert.equal(nextId, 10000, 'next id should follow max(id), not collide on UNIQUE');
  });

  test('persists task to db', () => {
    const { id } = makeTask({ title: 'Persist me' });
    assert.equal(store.getById(id)?.title, 'Persist me');
  });

  test('persists scope', () => {
    const { id } = makeTask({ scope: 'auth' });
    assert.equal(store.getById(id)?.scope, 'auth');
  });

  test('persists summary', () => {
    const { id } = makeTask({ summary: 'A short gist.' });
    assert.equal(store.getById(id)?.summary, 'A short gist.');
  });

  test('defaults status to refinement when not given', () => {
    const { id } = store.add({ type: 'feature', priority: 'low', title: 'X', description: '' });
    assert.equal(store.getById(id)?.status, 'refinement');
  });

  test('rejects empty title', () => {
    assert.throws(() => store.add({ type: 'bug', priority: 'high', title: '   ', description: '' }), /title must not be empty/);
  });

  test('persists refs', () => {
    const { id: a } = makeTask();
    const { id: b } = store.add({ type: 'bug', priority: 'high', title: 'B', description: '', refs: [{ id: a, relation: 'blocks' }] });
    assert.deepEqual(store.getById(b)?.refs, [{ id: a, relation: 'blocks' }]);
  });
});

describe('getById', () => {
  test('returns null for unknown id', () => {
    assert.equal(store.getById(999), null);
  });

  test('returns the task for an existing id', () => {
    const { id } = makeTask({ title: 'Hello' });
    assert.equal(store.getById(id)?.title, 'Hello');
  });
});

describe('update', () => {
  test('returns null for unknown id', () => {
    assert.equal(store.update(999, { title: 'X' }), null);
  });

  test('patches title', () => {
    const { id } = makeTask({ title: 'Old' });
    const r = store.update(id, { title: 'New' });
    assert.equal(r?.task.title, 'New');
  });

  test('clears scope when null', () => {
    const { id } = makeTask({ scope: 'web' });
    store.update(id, { scope: null });
    assert.equal(store.getById(id)?.scope, undefined);
  });

  test('clears summary when null', () => {
    const { id } = makeTask({ summary: 'gist' });
    store.update(id, { summary: null });
    assert.equal(store.getById(id)?.summary, undefined);
  });

  test('replaces refs entirely', () => {
    const { id: a } = makeTask();
    const { id: b } = makeTask();
    const { id: c } = store.add({ type: 'bug', priority: 'high', title: 'C', description: '', refs: [{ id: a, relation: 'blocks' }] });
    store.update(c, { refs: [{ id: b, relation: 'depends on' }] });
    assert.deepEqual(store.getById(c)?.refs, [{ id: b, relation: 'depends on' }]);
  });

  test('clears refs with null', () => {
    const { id: a } = makeTask();
    const { id: b } = store.add({ type: 'bug', priority: 'high', title: 'B', description: '', refs: [{ id: a, relation: 'blocks' }] });
    store.update(b, { refs: null });
    assert.equal(store.getById(b)?.refs, undefined);
  });
});

describe('plan field', () => {
  test('add with plan persists it; getById returns it', () => {
    const { id } = makeTask({ plan: '# My Plan\n\n- step 1\n- step 2' });
    assert.equal(store.getById(id)?.plan, '# My Plan\n\n- step 1\n- step 2');
  });

  test('update with new plan replaces existing plan', () => {
    const { id } = makeTask({ plan: 'old plan' });
    store.update(id, { plan: 'new plan' });
    assert.equal(store.getById(id)?.plan, 'new plan');
  });

  test('update with plan: null clears the plan', () => {
    const { id } = makeTask({ plan: 'some plan' });
    store.update(id, { plan: null });
    assert.equal(store.getById(id)?.plan, undefined);
  });

  test('update with empty string clears the plan', () => {
    const { id } = makeTask({ plan: 'some plan' });
    store.update(id, { plan: '' });
    assert.equal(store.getById(id)?.plan, undefined);
  });

  test('task without plan has plan undefined', () => {
    const { id } = makeTask();
    assert.equal(store.getById(id)?.plan, undefined);
  });
});

describe('setStatus', () => {
  test('returns false for unknown id', () => {
    assert.equal(store.setStatus(999, 'done'), false);
  });

  test('marks task as done', () => {
    const { id } = makeTask();
    assert.equal(store.setStatus(id, 'done'), true);
    assert.equal(store.getById(id)?.status, 'done');
  });

  test('un-dones a task back to todo', () => {
    const { id } = makeTask();
    store.setStatus(id, 'done');
    store.setStatus(id, 'todo');
    assert.equal(store.getById(id)?.status, 'todo');
  });

  test('load() splits active/done by status', () => {
    const { id: a } = makeTask({ title: 'Active' });
    const { id: d } = makeTask({ title: 'Done' });
    store.setStatus(d, 'done');
    const { active, done } = store.load();
    assert.ok(active.find((t) => t.id === a));
    assert.ok(done.find((t) => t.id === d));
  });
});

describe('delete', () => {
  test('returns false for unknown id', () => {
    assert.equal(store.delete(999), false);
  });

  test('removes task', () => {
    const { id } = makeTask();
    assert.equal(store.delete(id), true);
    assert.equal(store.getById(id), null);
  });

  test('cascades refs in both directions', () => {
    const { id: a } = makeTask();
    const { id: b } = store.add({ type: 'bug', priority: 'high', title: 'B', description: '', refs: [{ id: a, relation: 'blocks' }] });
    store.delete(a);
    assert.equal(store.getById(b)?.refs, undefined);
  });
});

describe('refs — store-level mirroring', () => {
  test('writes inverse on canonical ref', () => {
    const { id: a } = makeTask();
    const { id: b } = store.add({ type: 'bug', priority: 'high', title: 'B', description: '', refs: [{ id: a, relation: 'blocks' }] });
    assert.deepEqual(store.getById(a)?.refs, [{ id: b, relation: 'is blocked by' }]);
  });

  test('removes inverse when ref is removed', () => {
    const { id: a } = makeTask();
    const { id: b } = store.add({ type: 'bug', priority: 'high', title: 'B', description: '', refs: [{ id: a, relation: 'blocks' }] });
    store.update(b, { refs: [] });
    assert.equal(store.getById(a)?.refs, undefined);
  });

  test('updates inverse on relation change', () => {
    const { id: a } = makeTask();
    const { id: b } = store.add({ type: 'bug', priority: 'high', title: 'B', description: '', refs: [{ id: a, relation: 'blocks' }] });
    store.update(b, { refs: [{ id: a, relation: 'causes' }] });
    assert.deepEqual(store.getById(a)?.refs, [{ id: b, relation: 'is caused by' }]);
  });

  test('"relates to" is symmetric on both sides', () => {
    const { id: a } = makeTask();
    const { id: b } = store.add({ type: 'bug', priority: 'high', title: 'B', description: '', refs: [{ id: a, relation: 'relates to' }] });
    assert.equal(store.getById(a)?.refs?.[0]?.relation, 'relates to');
    assert.equal(store.getById(b)?.refs?.[0]?.relation, 'relates to');
  });

  test('strips refs to nonexistent ids', () => {
    const { id } = store.add({ type: 'bug', priority: 'high', title: 'X', description: '', refs: [{ id: 9999, relation: 'blocks' }] });
    assert.equal(store.getById(id)?.refs, undefined);
  });

  test('strips self-refs', () => {
    const { id } = makeTask();
    store.update(id, { refs: [{ id, relation: 'relates to' }] });
    assert.equal(store.getById(id)?.refs, undefined);
  });

  test('INSERT OR REPLACE — updating relation on existing (from, to) pair overwrites it', () => {
    const { id: a } = makeTask({ title: 'A' });
    const { id: b } = makeTask({ title: 'B' });
    store.update(a, { refs: [{ id: b, relation: 'relates to' }] });
    assert.equal(store.getById(a)?.refs?.[0]?.relation, 'relates to');
    store.update(a, { refs: [{ id: b, relation: 'blocks' }] });
    const refsOnA = store.getById(a)?.refs;
    assert.equal(refsOnA?.length, 1);
    assert.equal(refsOnA?.[0]?.relation, 'blocks');
    const refsOnB = store.getById(b)?.refs;
    assert.equal(refsOnB?.length, 1);
    assert.equal(refsOnB?.[0]?.relation, 'is blocked by');
  });

  test('mirror-delete fix — removing canonical ref deletes only its mirror, not unrelated refs on target', () => {
    const { id: a } = makeTask({ title: 'A' });
    const { id: b } = makeTask({ title: 'B' });
    const { id: c } = makeTask({ title: 'C' });
    store.update(a, { refs: [{ id: b, relation: 'blocks' }] });
    store.update(c, { refs: [{ id: b, relation: 'relates to' }] });
    const refsOnBBefore = store.getById(b)?.refs;
    assert.equal(refsOnBBefore?.length, 2);
    store.update(a, { refs: [] });
    assert.equal(store.getById(a)?.refs, undefined);
    const refsOnBAfter = store.getById(b)?.refs;
    assert.equal(refsOnBAfter?.length, 1);
    assert.equal(refsOnBAfter?.[0]?.id, c);
    assert.equal(refsOnBAfter?.[0]?.relation, 'relates to');
  });

  test('non-canonical refs are NOT mirrored on the target task', () => {
    const { id: a } = makeTask({ title: 'A' });
    const { id: c } = makeTask({ title: 'C' });
    const db = new Database(dbPath);
    db.prepare('INSERT INTO refs (from_id, to_id, relation, non_canonical) VALUES (?, ?, ?, 1)')
      .run(a, c, 'is blocked by');
    db.close();
    const { id: b } = makeTask({ title: 'B' });
    store.update(a, { refs: [{ id: b, relation: 'blocks' }] });
    const refsOnB = store.getById(b)?.refs;
    assert.equal(refsOnB?.length, 1);
    assert.equal(refsOnB?.[0]?.relation, 'is blocked by');
    assert.equal(refsOnB?.[0]?.id, a);
  });
});

describe('getByStatus', () => {
  test('returns only tasks with the given status', () => {
    makeTask({ title: 'T1' });
    const { id } = makeTask({ title: 'T2' });
    store.setStatus(id, 'done');
    assert.equal(store.getByStatus('todo').length, 0);
    assert.equal(store.getByStatus('refinement').length, 1);
    assert.equal(store.getByStatus('done').length, 1);
  });

  test('scope filter narrows results', () => {
    makeTask({ scope: 'web' });
    makeTask({ scope: 'cli' });
    const filtered = store.getByStatus('refinement', 'web');
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.scope, 'web');
  });

  test('scope filter is case-sensitive — "Web" does not match "web"', () => {
    makeTask({ scope: 'web' });
    assert.equal(store.getByStatus('refinement', 'Web').length, 0);
    assert.equal(store.getByStatus('refinement', 'WEB').length, 0);
    assert.equal(store.getByStatus('refinement', 'web').length, 1);
  });

  test('returns an array (not null/undefined) when nothing matches', () => {
    const result = store.getByStatus('todo', 'ghost-scope');
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });
});

describe('getByScope', () => {
  test('returns tasks tagged with the scope', () => {
    makeTask({ scope: 'web' });
    makeTask({ scope: 'cli' });
    assert.equal(store.getByScope('web').length, 1);
  });

  test('returns empty for unknown scope', () => {
    makeTask({ scope: 'web' });
    assert.deepEqual(store.getByScope('nope'), []);
  });
});

describe('getByType', () => {
  test('returns tasks of the given type', () => {
    makeTask({ type: 'bug' });
    makeTask({ type: 'feature' });
    const r = store.getByType('bug');
    assert.equal(r.length, 1);
    assert.equal(r[0]?.type, 'bug');
  });
});

describe('getNext', () => {
  test('returns null when nothing actionable', () => {
    assert.equal(store.getNext(), null);
  });

  test('prefers in_progress over refinement and todo', () => {
    makeTask({ title: 'refining' });
    const { id: ip } = makeTask({ title: 'going' });
    const { id: t } = makeTask({ title: 'queued' });
    store.setStatus(ip, 'in_progress');
    store.setStatus(t, 'todo');
    assert.equal(store.getNext()?.id, ip);
  });

  test('respects priority within same status', () => {
    const { id: low } = makeTask({ priority: 'low' });
    const { id: high } = makeTask({ priority: 'high' });
    store.setStatus(low, 'todo');
    store.setStatus(high, 'todo');
    assert.equal(store.getNext()?.id, high);
  });

  test('FILO within same priority — newer id wins', () => {
    const { id: older } = makeTask({ priority: 'medium' });
    const { id: newer } = makeTask({ priority: 'medium' });
    store.setStatus(older, 'todo');
    store.setStatus(newer, 'todo');
    assert.equal(store.getNext()?.id, newer);
  });

  test('type filter narrows', () => {
    const { id: b } = makeTask({ type: 'bug' });
    makeTask({ type: 'feature' });
    store.setStatus(b, 'todo');
    assert.equal(store.getNext('bug')?.id, b);
  });

  test('skips done tasks', () => {
    const { id } = makeTask();
    store.setStatus(id, 'done');
    assert.equal(store.getNext(), null);
  });
});

describe('getOverview', () => {
  test('counts per type with refinement/open/done buckets (default = non-done)', () => {
    const { id: t1 } = makeTask({ type: 'bug' });
    store.setStatus(t1, 'todo');
    makeTask({ type: 'feature' });
    const { id: t3 } = makeTask({ type: 'bug' });
    store.setStatus(t3, 'done');
    // Default (non-done): done tasks are excluded; returns four-bucket shape
    const ov = store.getOverview();
    const bug = ov.find((o) => o.type === 'bug') as { type: string; open: number; done: number; refinement: number; plan: number } | undefined;
    assert.equal(bug?.open, 1);
    assert.equal(bug?.done, 0);
    const feature = ov.find((o) => o.type === 'feature') as { type: string; refinement: number; plan: number } | undefined;
    assert.equal(feature?.refinement, 1);
  });

  test('status: "done" shows only done tasks — count shape, no zero-buckets', () => {
    const { id: t1 } = makeTask({ type: 'bug' });
    store.setStatus(t1, 'todo');
    const { id: t3 } = makeTask({ type: 'bug' });
    store.setStatus(t3, 'done');
    const ov = store.getOverview('done');
    const bug = ov.find((o) => o.type === 'bug') as { type: string; count: number; status: string } | undefined;
    assert.equal(bug?.count, 1);
    assert.equal(bug?.status, 'done');
    assert.ok(bug && !('open' in bug), 'open bucket should not appear');
  });

  test('omits types with zero tasks', () => {
    makeTask({ type: 'bug' });
    const ov = store.getOverview();
    assert.equal(ov.length, 1);
  });

  test('each entry has actionable (open + refinement) and total fields shape', () => {
    const { id: t1 } = makeTask({ type: 'bug' });
    store.setStatus(t1, 'todo');
    const { id: t2 } = makeTask({ type: 'bug' });
    store.setStatus(t2, 'done');
    makeTask({ type: 'bug' });
    // Default (non-done) always returns four-bucket shape
    const ovNonDone = store.getOverview();
    const bugNonDone = ovNonDone.find((o) => o.type === 'bug') as
      { type: string; open: number; done: number; refinement: number; plan: number } | undefined;
    assert.ok(bugNonDone);
    assert.equal(typeof bugNonDone.open, 'number');
    assert.equal(typeof bugNonDone.done, 'number');
    assert.equal(typeof bugNonDone.refinement, 'number');
    assert.equal(bugNonDone.open, 1);
    assert.equal(bugNonDone.done, 0);
    assert.equal(bugNonDone.refinement, 1);
    const actionable = bugNonDone.open + bugNonDone.refinement;
    assert.equal(actionable, 2);
  });
});

describe('getRelated', () => {
  test('returns null for unknown id', () => {
    assert.equal(store.getRelated(999), null);
  });

  test('separates outbound and inbound', () => {
    const { id: a } = makeTask({ title: 'A' });
    const { id: b } = store.add({ type: 'bug', priority: 'high', title: 'B', description: '', refs: [{ id: a, relation: 'blocks' }] });
    const r = store.getRelated(b);
    assert.equal(r?.outbound[0]?.id, a);
    assert.equal(r?.outbound[0]?.refRelation, 'blocks');
    const ra = store.getRelated(a);
    assert.equal(ra?.inbound[0]?.id, b);
    assert.equal(ra?.inbound[0]?.refRelation, 'blocks');
  });

  test('no-outbound edge — task with no refs has empty outbound array', () => {
    const { id } = makeTask({ title: 'Lonely' });
    const r = store.getRelated(id);
    assert.deepEqual(r?.outbound, []);
  });

  test('no-inbound edge — task nobody points to has empty inbound array', () => {
    const { id } = makeTask({ title: 'Solo' });
    const r = store.getRelated(id);
    assert.deepEqual(r?.inbound, []);
  });

  test('no-refs edge — task with no refs at all has both arrays empty', () => {
    const { id } = makeTask({ title: 'Isolated' });
    const r = store.getRelated(id);
    assert.deepEqual(r?.outbound, []);
    assert.deepEqual(r?.inbound, []);
    assert.equal(r?.task.refs, undefined);
  });
});

describe('getScopes', () => {
  test('returns scopes with counts; excludes scope-less tasks', () => {
    makeTask({ scope: 'web' });
    const { id: cli1 } = makeTask({ scope: 'cli' });
    makeTask({ scope: 'cli' });
    makeTask();
    store.setStatus(cli1, 'done');

    const scopes = store.getScopes();
    const cli = scopes.find((s) => s.scope === 'cli');
    assert.equal(cli?.total, 2);
    assert.equal(cli?.open, 1);
    const web = scopes.find((s) => s.scope === 'web');
    assert.equal(web?.total, 1);
    assert.equal(web?.open, 1);
  });

  test('orders by open desc, then total desc, then alpha', () => {
    makeTask({ scope: 'b' });
    makeTask({ scope: 'a' });
    const scopes = store.getScopes();
    assert.deepEqual(scopes.map((s) => s.scope), ['a', 'b']);
  });
});

describe('sortByPriority', () => {
  test('orders by priority desc then id desc', () => {
    const tasks = [
      { id: 1, priority: 'low' as const },
      { id: 2, priority: 'high' as const },
      { id: 3, priority: 'high' as const },
      { id: 4, priority: 'medium' as const },
    ];
    assert.deepEqual(sortByPriority(tasks).map((t) => t.id), [3, 2, 4, 1]);
  });
});

describe('sortForNext', () => {
  test('in_progress > refinement > todo', () => {
    const tasks = [
      { id: 1, status: 'todo' as const, priority: 'medium' as const },
      { id: 2, status: 'in_progress' as const, priority: 'medium' as const },
      { id: 3, status: 'refinement' as const, priority: 'medium' as const },
    ];
    assert.deepEqual(sortForNext(tasks).map((t) => t.id), [2, 3, 1]);
  });

  test('STATUS_ORDER: in_progress > refinement > plan > todo > done', () => {
    const tasks = [
      { id: 1, status: 'done' as const,        priority: 'medium' as const },
      { id: 2, status: 'todo' as const,         priority: 'medium' as const },
      { id: 3, status: 'plan' as const,         priority: 'medium' as const },
      { id: 4, status: 'refinement' as const,   priority: 'medium' as const },
      { id: 5, status: 'in_progress' as const,  priority: 'medium' as const },
    ];
    assert.deepEqual(sortForNext(tasks).map((t) => t.id), [5, 4, 3, 2, 1]);
  });
});

describe('plan status', () => {
  test('setStatus accepts plan', () => {
    const { id } = makeTask();
    assert.equal(store.setStatus(id, 'plan'), true);
    assert.equal(store.getById(id)?.status, 'plan');
  });

  test('resolveStatusFilter open includes plan', () => {
    const resolved = resolveStatusFilter('open');
    assert.ok(Array.isArray(resolved));
    assert.ok((resolved as string[]).includes('plan'));
  });

  test('getNext includes plan-status tasks', () => {
    const { id: a } = makeTask({ title: 'plan-task' });
    store.setStatus(a, 'plan');
    const next = store.getNext();
    assert.equal(next?.id, a);
  });

  test('getAll open includes plan-status tasks', () => {
    const { id } = makeTask({ title: 'plan-task' });
    store.setStatus(id, 'plan');
    const all = store.getAll('open');
    assert.ok(all.some((t) => t.id === id));
  });

  test('getOverview has a plan count in three-bucket shape', () => {
    const { id } = makeTask({ type: 'bug' });
    store.setStatus(id, 'plan');
    const ov = store.getOverview();
    const bug = ov.find((o) => o.type === 'bug') as
      { type: string; refinement: number; plan: number; open: number; done: number } | undefined;
    assert.ok(bug, 'bug entry should exist');
    assert.equal(bug?.plan, 1);
    assert.equal(bug?.open, 0);
    assert.equal(bug?.refinement, 0);
  });
});

describe('RELATIONS export', () => {
  test('contains the canonical 9-entry vocabulary', () => {
    assert.equal(RELATIONS.length, 9);
    assert.ok((RELATIONS as readonly string[]).includes('blocks'));
    assert.ok((RELATIONS as readonly string[]).includes('relates to'));
  });
});

describe('cross-connection visibility', () => {
  test('a second connection sees writes immediately under DELETE journaling', () => {
    makeTask({ title: 'first' });
    const reader = new Database(dbPath, { readonly: true });
    const before = (reader.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n;
    makeTask({ title: 'second' });
    const after = (reader.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n;
    assert.equal(before, 1);
    assert.equal(after, 2);
    reader.close();
  });
});

describe('persistence', () => {
  test('reopening the store preserves state', () => {
    const { id } = makeTask({ title: 'survive' });
    store.close();
    store = createStore(dbPath);
    assert.equal(store.getById(id)?.title, 'survive');
  });

  test('id sequence survives reopen', () => {
    makeTask();
    store.close();
    store = createStore(dbPath);
    const { id } = makeTask();
    assert.equal(id, 2);
  });
});

describe('summary — store always returns complete data', () => {
  test('add with summary stores it; all read methods return both summary and description', () => {
    const { id } = store.add({
      type: 'feature', priority: 'medium', title: 'S',
      description: 'Full description text.', summary: 'Short gist.',
    });
    const byId = store.getById(id);
    assert.equal(byId?.summary, 'Short gist.');
    assert.equal(byId?.description, 'Full description text.');
    const byType = store.getByType('feature').find((t) => t.id === id);
    assert.equal(byType?.summary, 'Short gist.');
    assert.equal(byType?.description, 'Full description text.');
    const { active } = store.load();
    const loaded = active.find((t) => t.id === id);
    assert.equal(loaded?.summary, 'Short gist.');
    assert.equal(loaded?.description, 'Full description text.');
  });

  test('update sets summary; update with null clears it', () => {
    const { id } = store.add({ type: 'bug', priority: 'low', title: 'X', description: 'D' });
    store.update(id, { summary: 'A gist.' });
    assert.equal(store.getById(id)?.summary, 'A gist.');
    store.update(id, { summary: null });
    assert.equal(store.getById(id)?.summary, undefined);
  });

  test('update with empty string clears summary', () => {
    const { id } = store.add({ type: 'bug', priority: 'low', title: 'X', description: 'D', summary: 'gist' });
    store.update(id, { summary: '' });
    assert.equal(store.getById(id)?.summary, undefined);
  });

  test('getRelated returns both summary and description for all entries', () => {
    const { id: a } = store.add({
      type: 'bug', priority: 'medium', title: 'A',
      description: 'A description.', summary: 'A gist.',
    });
    const { id: b } = store.add({
      type: 'bug', priority: 'medium', title: 'B',
      description: 'B description.', summary: 'B gist.',
      refs: [{ id: a, relation: 'blocks' }],
    });
    const rb = store.getRelated(b);
    assert.equal(rb?.task.summary, 'B gist.');
    assert.equal(rb?.task.description, 'B description.');
    assert.equal(rb?.outbound[0]?.summary, 'A gist.');
    assert.equal(rb?.outbound[0]?.description, 'A description.');

    const ra = store.getRelated(a);
    assert.equal(ra?.inbound[0]?.summary, 'B gist.');
    assert.equal(ra?.inbound[0]?.description, 'B description.');
  });

  test('setStatus does NOT enforce summary — enforcement is in server layer', () => {
    const { id } = store.add({ type: 'bug', priority: 'medium', title: 'T', description: '' });
    const ok = store.setStatus(id, 'todo');
    assert.equal(ok, true);
    assert.equal(store.getById(id)?.status, 'todo');
  });
});

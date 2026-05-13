import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import {
  createStore,
  applyRefs,
  cascadeDelete,
  sortByPriority,
  sortForNext,
  RELATIONS,
  type AddInput,
  type Store,
} from './tasks.js';

const MIGRATION_NAMES = [
  '20260101000000_initial-schema',
  '20260513000000_normalize-literal-newlines',
  '20260513000001_refs-pk-simplify',
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

  test('seeds counter = 0', () => {
    const { counter } = store.load();
    assert.equal(counter, 0);
  });

  test('uses DELETE journal mode (not WAL) for cross-namespace coherence', () => {
    const db = new Database(dbPath);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'delete');
    db.close();
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

  test('increments counter for sequential adds', () => {
    const { id: id1 } = makeTask({ title: 'A' });
    const { id: id2 } = makeTask({ title: 'B' });
    assert.equal(id2, id1 + 1);
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
  test('counts per type with refinement/open/done buckets', () => {
    const { id: t1 } = makeTask({ type: 'bug' });
    store.setStatus(t1, 'todo');
    makeTask({ type: 'feature' });
    const { id: t3 } = makeTask({ type: 'bug' });
    store.setStatus(t3, 'done');
    const ov = store.getOverview();
    const bug = ov.find((o) => o.type === 'bug');
    assert.equal(bug?.open, 1);
    assert.equal(bug?.done, 1);
    const feature = ov.find((o) => o.type === 'feature');
    assert.equal(feature?.refinement, 1);
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
    const ov = store.getOverview();
    const bug = ov.find((o) => o.type === 'bug');
    assert.ok(bug);
    assert.equal(typeof bug.open, 'number');
    assert.equal(typeof bug.done, 'number');
    assert.equal(typeof bug.refinement, 'number');
    assert.equal(bug.open, 1);
    assert.equal(bug.done, 1);
    assert.equal(bug.refinement, 1);
    const total = bug.open + bug.done + bug.refinement;
    assert.equal(total, 3);
    const actionable = bug.open + bug.refinement;
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
});

describe('applyRefs (in-memory helper)', () => {
  function makeT(id: number, extra: Partial<import('./tasks.js').Task> = {}): import('./tasks.js').Task {
    return { id, title: `T${id}`, type: 'bug', status: 'todo', priority: 'medium', description: '', ...extra };
  }
  test('adds inverse on counterpart', () => {
    const a = makeT(1);
    const b = makeT(2);
    applyRefs([a, b], 1, [], [{ id: 2, relation: 'blocks' }]);
    assert.deepEqual(b.refs, [{ id: 1, relation: 'is blocked by' }]);
  });
  test('removes inverse when ref is removed', () => {
    const a = makeT(1, { refs: [{ id: 2, relation: 'blocks' }] });
    const b = makeT(2, { refs: [{ id: 1, relation: 'is blocked by' }] });
    applyRefs([a, b], 1, [{ id: 2, relation: 'blocks' }], []);
    assert.equal(b.refs, undefined);
  });
  test('updates inverse on relation change', () => {
    const a = makeT(1, { refs: [{ id: 2, relation: 'blocks' }] });
    const b = makeT(2, { refs: [{ id: 1, relation: 'is blocked by' }] });
    applyRefs([a, b], 1, [{ id: 2, relation: 'blocks' }], [{ id: 2, relation: 'causes' }]);
    assert.equal(b.refs?.[0]?.relation, 'is caused by');
  });
  test('strips self-refs and dangling refs', () => {
    const a = makeT(1);
    applyRefs([a], 1, [], [{ id: 1, relation: 'relates to' }, { id: 9999, relation: 'blocks' }]);
    assert.equal(a.refs, undefined);
  });
});

describe('cascadeDelete (in-memory helper)', () => {
  function makeT(id: number, extra: Partial<import('./tasks.js').Task> = {}): import('./tasks.js').Task {
    return { id, title: `T${id}`, type: 'bug', status: 'todo', priority: 'medium', description: '', ...extra };
  }
  test('strips refs pointing to deleted id', () => {
    const t = makeT(1, { refs: [{ id: 99, relation: 'blocks' }] });
    cascadeDelete([t], 99);
    assert.equal(t.refs, undefined);
  });
  test('preserves refs to other ids', () => {
    const t = makeT(1, { refs: [{ id: 5, relation: 'relates to' }, { id: 99, relation: 'blocks' }] });
    cascadeDelete([t], 99);
    assert.deepEqual(t.refs, [{ id: 5, relation: 'relates to' }]);
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

  test('counter survives reopen', () => {
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

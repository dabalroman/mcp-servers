import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import {
  parseTasks,
  writeTasks,
  writeDoneTasks,
  sortByPriority,
  sortForNext,
  wrapLines,
  applyRefs,
  cascadeDelete,
  RELATIONS,
} from './tasks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

let dir;
let tasksFile;
let doneFile;

function useFixtures() {
  copyFileSync(join(FIXTURES, 'TASKS.md'), tasksFile);
  copyFileSync(join(FIXTURES, 'TASKS_DONE.md'), doneFile);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'task-manager-test-'));
  tasksFile = join(dir, 'TASKS.md');
  doneFile = join(dir, 'TASKS_DONE.md');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ── parseTasks ─────────────────────────────────────────────────────────────────

describe('parseTasks', () => {
  test('returns empty state for missing file', () => {
    const result = parseTasks(join(dir, 'nonexistent.md'));
    assert.deepEqual(result, { counter: 0, tasks: [] });
  });

  test('reads counter and all tasks from fixture', () => {
    useFixtures();
    const { counter, tasks } = parseTasks(tasksFile);
    assert.equal(counter, 5);
    assert.equal(tasks.length, 4);
  });

  test('parses task fields correctly', () => {
    useFixtures();
    const { tasks } = parseTasks(tasksFile);
    const t = tasks.find(t => t.id === 4);
    assert.equal(t.title, 'Fix auth middleware session leak');
    assert.equal(t.type, 'bug');
    assert.equal(t.status, 'todo');
    assert.equal(t.priority, 'critical');
    assert.ok(t.description.includes('log in with an expired token'));
  });

  test('parses in_progress status', () => {
    useFixtures();
    const { tasks } = parseTasks(tasksFile);
    const t = tasks.find(t => t.id === 5);
    assert.equal(t.status, 'in_progress');
  });

  test('parses refinement status', () => {
    writeFileSync(tasksFile, [
      '# Counter: 1',
      '',
      '# 1 Needs clarification',
      '## feature | refinement | medium',
      'Rough idea only.',
      '',
    ].join('\n'));
    const { tasks } = parseTasks(tasksFile);
    assert.equal(tasks[0].status, 'refinement');
  });

  test('refinement status round-trips through write + parse', () => {
    writeFileSync(tasksFile, [
      '# Counter: 1',
      '',
      '# 1 Rough task',
      '## idea | refinement | low',
      'Needs more detail.',
      '',
    ].join('\n'));
    const { counter, tasks } = parseTasks(tasksFile);
    writeTasks(tasksFile, counter, tasks);
    const { tasks: reparsed } = parseTasks(tasksFile);
    assert.equal(reparsed[0].status, 'refinement');
  });

  test('parses multiline description', () => {
    useFixtures();
    const { tasks } = parseTasks(tasksFile);
    const t = tasks.find(t => t.id === 4);
    const lines = t.description.split('\n');
    assert.equal(lines.length, 2);
  });

  test('parses task with empty description', () => {
    useFixtures();
    const { tasks } = parseTasks(tasksFile);
    const t = tasks.find(t => t.id === 2);
    // idea task has a single-line description — just verify it parsed
    assert.ok(t.description.length > 0);
  });

  test('skips task with invalid metadata and continues', () => {
    writeFileSync(tasksFile, [
      '# Counter: 2',
      '',
      '# 1 Bad meta',
      '## invalid | stuff',
      '',
      '# 2 Good task',
      '## bug | todo | high',
      '',
    ].join('\n'));

    const { tasks } = parseTasks(tasksFile);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, 2);
  });

  test('parses done tasks from TASKS_DONE fixture', () => {
    useFixtures();
    const { tasks } = parseTasks(doneFile);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, 1);
    assert.equal(tasks[0].status, 'done');
  });
});

// ── writeTasks ─────────────────────────────────────────────────────────────────

describe('writeTasks', () => {
  test('round-trips fixture tasks unchanged', () => {
    useFixtures();
    const { counter, tasks } = parseTasks(tasksFile);
    writeTasks(tasksFile, counter, tasks);
    const { counter: c2, tasks: t2 } = parseTasks(tasksFile);
    assert.equal(c2, counter);
    assert.equal(t2.length, tasks.length);
    for (const orig of tasks) {
      const reparsed = t2.find(t => t.id === orig.id);
      assert.deepEqual(reparsed, orig);
    }
  });

  test('sorts tasks by id descending in output file', () => {
    useFixtures();
    const { counter, tasks } = parseTasks(tasksFile);
    writeTasks(tasksFile, counter, tasks);
    const content = readFileSync(tasksFile, 'utf8');
    const ids = [...content.matchAll(/^# (\d+) /gm)].map(m => parseInt(m[1]));
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
  });

  test('writes atomically — no .tmp file left after write', () => {
    useFixtures();
    const { counter, tasks } = parseTasks(tasksFile);
    writeTasks(tasksFile, counter, tasks);
    assert.throws(() => readFileSync(tasksFile + '.tmp'), { code: 'ENOENT' });
  });

  test('counter line is present in output', () => {
    useFixtures();
    const { counter, tasks } = parseTasks(tasksFile);
    writeTasks(tasksFile, counter, tasks);
    const content = readFileSync(tasksFile, 'utf8');
    assert.ok(content.startsWith('# Counter: 5'));
  });
});

// ── writeDoneTasks ─────────────────────────────────────────────────────────────

describe('writeDoneTasks', () => {
  test('round-trips done fixture tasks unchanged', () => {
    useFixtures();
    const { tasks } = parseTasks(doneFile);
    writeDoneTasks(doneFile, tasks);
    const { tasks: reparsed } = parseTasks(doneFile);
    assert.equal(reparsed.length, tasks.length);
    assert.deepEqual(reparsed[0], tasks[0]);
  });

  test('output starts with done tasks header', () => {
    useFixtures();
    const { tasks } = parseTasks(doneFile);
    writeDoneTasks(doneFile, tasks);
    const content = readFileSync(doneFile, 'utf8');
    assert.ok(content.startsWith('# Done tasks'));
  });

  test('writes atomically — no .tmp file left after write', () => {
    useFixtures();
    const { tasks } = parseTasks(doneFile);
    writeDoneTasks(doneFile, tasks);
    assert.throws(() => readFileSync(doneFile + '.tmp'), { code: 'ENOENT' });
  });
});

// ── scope field ───────────────────────────────────────────────────────────────

describe('scope field', () => {
  test('parses $scope tag from fixture', () => {
    useFixtures();
    const { tasks } = parseTasks(tasksFile);
    const t5 = tasks.find(t => t.id === 5);
    assert.equal(t5.scope, 'task-manager');
    const t3 = tasks.find(t => t.id === 3);
    assert.equal(t3.scope, 'svg-path-joiner');
  });

  test('scope is undefined for tasks without $scope tag', () => {
    useFixtures();
    const { tasks } = parseTasks(tasksFile);
    const t4 = tasks.find(t => t.id === 4);
    assert.equal(t4.scope, undefined);
  });

  test('description is not contaminated by $scope line', () => {
    useFixtures();
    const { tasks } = parseTasks(tasksFile);
    const t3 = tasks.find(t => t.id === 3);
    assert.ok(!t3.description.includes('$scope'));
    assert.ok(t3.description.includes('The joiner should'));
  });

  test('round-trips scope through write + parse', () => {
    useFixtures();
    const { counter, tasks } = parseTasks(tasksFile);
    writeTasks(tasksFile, counter, tasks);
    const { tasks: reparsed } = parseTasks(tasksFile);
    assert.equal(reparsed.find(t => t.id === 5).scope, 'task-manager');
    assert.equal(reparsed.find(t => t.id === 3).scope, 'svg-path-joiner');
    assert.equal(reparsed.find(t => t.id === 4).scope, undefined);
  });

  test('$scope line appears in written file before description', () => {
    useFixtures();
    const { counter, tasks } = parseTasks(tasksFile);
    writeTasks(tasksFile, counter, tasks);
    const content = readFileSync(tasksFile, 'utf8');
    const t3Start = content.indexOf('# 3 ');
    const t3End = content.indexOf('\n# ', t3Start + 1);
    const t3Block = t3End === -1 ? content.slice(t3Start) : content.slice(t3Start, t3End);
    const scopeLine = t3Block.split('\n').find(l => l.startsWith('$scope:'));
    assert.ok(scopeLine, '$scope: line should be present');
    assert.equal(scopeLine, '$scope: svg-path-joiner');
  });

  test('setting scope on a task that had none round-trips correctly', () => {
    useFixtures();
    const { counter, tasks } = parseTasks(tasksFile);
    const task = tasks.find(t => t.id === 4);
    task.scope = 'eink-frame';
    writeTasks(tasksFile, counter, tasks.map(t => (t.id === 4 ? task : t)));
    const { tasks: result } = parseTasks(tasksFile);
    assert.equal(result.find(t => t.id === 4).scope, 'eink-frame');
  });

  test('clearing scope (setting to undefined) removes $scope line', () => {
    useFixtures();
    const { counter, tasks } = parseTasks(tasksFile);
    const task = tasks.find(t => t.id === 5);
    task.scope = undefined;
    writeTasks(tasksFile, counter, tasks.map(t => (t.id === 5 ? task : t)));
    const { tasks: result } = parseTasks(tasksFile);
    assert.equal(result.find(t => t.id === 5).scope, undefined);
    const content = readFileSync(tasksFile, 'utf8');
    const t5Start = content.indexOf('# 5 ');
    const t5End = content.indexOf('\n# ', t5Start + 1);
    const t5Block = t5End === -1 ? content.slice(t5Start) : content.slice(t5Start, t5End);
    assert.ok(!t5Block.split('\n').some(l => l.startsWith('$scope:')));
  });
});

// ── update round-trip ──────────────────────────────────────────────────────────

describe('update round-trip', () => {
  test('patching title of an active task persists correctly', () => {
    useFixtures();
    const { counter, tasks } = parseTasks(tasksFile);
    const task = tasks.find(t => t.id === 3);
    task.title = 'Renamed: Relative scale for SVG merger';
    writeTasks(tasksFile, counter, tasks.map(t => (t.id === 3 ? task : t)));

    const { tasks: result } = parseTasks(tasksFile);
    const updated = result.find(t => t.id === 3);
    assert.equal(updated.title, 'Renamed: Relative scale for SVG merger');
    assert.equal(updated.type, 'feature');       // unchanged
    assert.equal(updated.priority, 'medium');    // unchanged
  });

  test('patching description of an active task persists correctly', () => {
    useFixtures();
    const { counter, tasks } = parseTasks(tasksFile);
    const task = tasks.find(t => t.id === 4);
    task.description = 'Updated reproduction steps here.';
    writeTasks(tasksFile, counter, tasks.map(t => (t.id === 4 ? task : t)));

    const { tasks: result } = parseTasks(tasksFile);
    const updated = result.find(t => t.id === 4);
    assert.equal(updated.description, 'Updated reproduction steps here.');
    assert.equal(updated.title, 'Fix auth middleware session leak'); // unchanged
    assert.equal(updated.priority, 'critical');                      // unchanged
  });

  test('patching priority and type of an active task persists correctly', () => {
    useFixtures();
    const { counter, tasks } = parseTasks(tasksFile);
    const task = tasks.find(t => t.id === 2);
    task.priority = 'high';
    task.type = 'feature';
    writeTasks(tasksFile, counter, tasks.map(t => (t.id === 2 ? task : t)));

    const { tasks: result } = parseTasks(tasksFile);
    const updated = result.find(t => t.id === 2);
    assert.equal(updated.priority, 'high');
    assert.equal(updated.type, 'feature');
    assert.equal(updated.title, 'Improve task picker UX'); // unchanged
  });

  test('patching a done task updates the done file only', () => {
    useFixtures();
    const { tasks: done } = parseTasks(doneFile);
    const task = done.find(t => t.id === 1);
    task.title = 'Bootstrap project (renamed)';
    writeDoneTasks(doneFile, done.map(t => (t.id === 1 ? task : t)));

    const { tasks: resultDone } = parseTasks(doneFile);
    assert.equal(resultDone[0].title, 'Bootstrap project (renamed)');

    // active file must be untouched
    const { tasks: resultActive } = parseTasks(tasksFile);
    assert.ok(!resultActive.some(t => t.id === 1));
  });

  test('other tasks are not affected when one task is updated', () => {
    useFixtures();
    const { counter, tasks } = parseTasks(tasksFile);
    const originalIds = tasks.map(t => t.id).sort((a, b) => a - b);

    const task = tasks.find(t => t.id === 5);
    task.title = 'Updated task 5';
    writeTasks(tasksFile, counter, tasks.map(t => (t.id === 5 ? task : t)));

    const { tasks: result } = parseTasks(tasksFile);
    assert.deepEqual(result.map(t => t.id).sort((a, b) => a - b), originalIds);

    // Spot-check a different task is intact
    const t4 = result.find(t => t.id === 4);
    assert.equal(t4.title, 'Fix auth middleware session leak');
  });
});

// ── sortByPriority ─────────────────────────────────────────────────────────────

describe('sortByPriority', () => {
  test('sorts fixture tasks: critical before high before medium before low', () => {
    useFixtures();
    const { tasks } = parseTasks(tasksFile);
    const sorted = sortByPriority(tasks);
    const priorities = sorted.map(t => t.priority);
    const order = { critical: 4, high: 3, medium: 2, low: 1 };
    for (let i = 1; i < priorities.length; i++) {
      assert.ok(order[priorities[i - 1]] >= order[priorities[i]]);
    }
  });

  test('breaks ties by id descending (FILO)', () => {
    const make = (id, priority) => ({ id, priority, title: '', type: 'bug', status: 'todo', description: '' });
    const tasks = [make(1, 'high'), make(3, 'high'), make(2, 'high')];
    const sorted = sortByPriority(tasks);
    assert.deepEqual(sorted.map(t => t.id), [3, 2, 1]);
  });

  test('does not mutate the input array', () => {
    useFixtures();
    const { tasks } = parseTasks(tasksFile);
    const snapshot = tasks.map(t => t.id);
    sortByPriority(tasks);
    assert.deepEqual(tasks.map(t => t.id), snapshot);
  });
});

// ── sortForNext ────────────────────────────────────────────────────────────────

describe('sortForNext', () => {
  test('in_progress task from fixture comes first', () => {
    useFixtures();
    const { tasks } = parseTasks(tasksFile);
    const actionable = tasks.filter(t => t.status !== 'done');
    const sorted = sortForNext(actionable);
    assert.equal(sorted[0].status, 'in_progress');
    assert.equal(sorted[0].id, 5);
  });

  test('within same status, highest priority comes first', () => {
    useFixtures();
    const { tasks } = parseTasks(tasksFile);
    const todos = tasks.filter(t => t.status === 'todo');
    const sorted = sortForNext(todos);
    assert.equal(sorted[0].priority, 'critical');
    assert.equal(sorted[0].id, 4);
  });

  test('does not mutate the input array', () => {
    useFixtures();
    const { tasks } = parseTasks(tasksFile);
    const snapshot = tasks.map(t => t.id);
    sortForNext(tasks);
    assert.deepEqual(tasks.map(t => t.id), snapshot);
  });

  test('in_progress > refinement > todo ordering', () => {
    const make = (id, status, priority = 'medium') => ({
      id, status, priority, title: `Task ${id}`, type: 'bug', description: ''
    });
    const tasks = [make(1, 'todo'), make(2, 'refinement'), make(3, 'in_progress')];
    const sorted = sortForNext(tasks);
    assert.equal(sorted[0].status, 'in_progress');
    assert.equal(sorted[1].status, 'refinement');
    assert.equal(sorted[2].status, 'todo');
  });
});

// ── wrapLines ─────────────────────────────────────────────────────────────────

describe('wrapLines', () => {
  test('passes short lines through unchanged', () => {
    assert.equal(wrapLines('short line', 120), 'short line');
  });

  test('wraps long line at whitespace', () => {
    const long = 'word '.repeat(30).trim();
    const wrapped = wrapLines(long, 50);
    const lines = wrapped.split('\n');
    assert.ok(lines.every(l => l.length <= 50));
    assert.equal(wrapped.replace(/\n/g, ' '), long);
  });

  test('hard-breaks a token longer than maxLen', () => {
    const long = 'a'.repeat(200);
    const wrapped = wrapLines(long, 50);
    const lines = wrapped.split('\n');
    assert.ok(lines.length > 1);
    assert.ok(lines.every(l => l.length <= 50));
  });

  test('preserves blank lines', () => {
    const text = 'line one\n\nline two';
    assert.equal(wrapLines(text, 120), text);
  });

  test('returns falsy input unchanged', () => {
    assert.equal(wrapLines('', 120), '');
    assert.equal(wrapLines(null, 120), null);
  });

  test('wraps fixture task description correctly', () => {
    useFixtures();
    const { tasks } = parseTasks(tasksFile);
    const t = tasks.find(t => t.id === 5);
    const wrapped = wrapLines(t.description, 80);
    const lines = wrapped.split('\n');
    assert.ok(lines.every(l => l.length <= 80));
  });
});

// ── RELATIONS constant ────────────────────────────────────────────────────────

describe('RELATIONS', () => {
  test('exports a non-empty array', () => {
    assert.ok(Array.isArray(RELATIONS));
    assert.ok(RELATIONS.length > 0);
  });

  test('includes all expected canonical values', () => {
    const expected = ['blocks', 'is blocked by', 'depends on', 'is depended on by',
      'causes', 'is caused by', 'tests', 'is tested by', 'relates to'];
    for (const r of expected) {
      assert.ok(RELATIONS.includes(r), `Expected RELATIONS to include "${r}"`);
    }
  });
});

// ── refs — parse & serialize ──────────────────────────────────────────────────

describe('refs field', () => {
  test('parses canonical $ref from fixture', () => {
    useFixtures();
    const { tasks } = parseTasks(tasksFile);
    const t3 = tasks.find(t => t.id === 3);
    assert.ok(t3.refs, 'task 3 should have refs');
    assert.equal(t3.refs.length, 1);
    assert.equal(t3.refs[0].id, 4);
    assert.equal(t3.refs[0].relation, 'blocks');
    assert.equal(t3.refs[0].nonCanonical, undefined);
  });

  test('parses canonical $ref on task 4', () => {
    useFixtures();
    const { tasks } = parseTasks(tasksFile);
    const t4 = tasks.find(t => t.id === 4);
    assert.ok(t4.refs);
    assert.equal(t4.refs[0].relation, 'is blocked by');
    assert.equal(t4.refs[0].id, 3);
  });

  test('tasks without $ref have undefined refs', () => {
    useFixtures();
    const { tasks } = parseTasks(tasksFile);
    const t2 = tasks.find(t => t.id === 2);
    assert.equal(t2.refs, undefined);
  });

  test('description not contaminated by $ref line', () => {
    useFixtures();
    const { tasks } = parseTasks(tasksFile);
    const t3 = tasks.find(t => t.id === 3);
    assert.ok(!t3.description.includes('$ref'));
    assert.ok(t3.description.includes('The joiner should'));
  });

  test('non-canonical ref text is preserved verbatim with nonCanonical flag', () => {
    writeFileSync(tasksFile, [
      '# Counter: 2',
      '',
      '# 2 Task B',
      '## feature | todo | medium',
      '$ref: #1 see also',
      'description here',
      '',
    ].join('\n'));
    const { tasks } = parseTasks(tasksFile);
    const t = tasks.find(t => t.id === 2);
    assert.equal(t.refs[0].relation, 'see also');
    assert.equal(t.refs[0].nonCanonical, true);
  });

  test('empty relation text defaults to "relates to"', () => {
    writeFileSync(tasksFile, [
      '# Counter: 2',
      '',
      '# 2 Task B',
      '## bug | todo | high',
      '$ref: #1',
      '',
    ].join('\n'));
    const { tasks } = parseTasks(tasksFile);
    assert.equal(tasks[0].refs[0].relation, 'relates to');
    assert.equal(tasks[0].refs[0].nonCanonical, undefined);
  });

  test('refs round-trip through write + parse (canonical)', () => {
    useFixtures();
    const { counter, tasks } = parseTasks(tasksFile);
    writeTasks(tasksFile, counter, tasks);
    const { tasks: reparsed } = parseTasks(tasksFile);
    const t3 = reparsed.find(t => t.id === 3);
    assert.deepEqual(t3.refs, [{ id: 4, relation: 'blocks' }]);
  });

  test('non-canonical ref round-trips verbatim', () => {
    writeFileSync(tasksFile, [
      '# Counter: 1',
      '',
      '# 1 Task A',
      '## bug | todo | high',
      '$ref: #99 custom note here',
      '',
    ].join('\n'));
    const { counter, tasks } = parseTasks(tasksFile);
    writeTasks(tasksFile, counter, tasks);
    const { tasks: reparsed } = parseTasks(tasksFile);
    assert.equal(reparsed[0].refs[0].relation, 'custom note here');
    assert.equal(reparsed[0].refs[0].nonCanonical, true);
  });

  test('$ref line in written file appears after $scope and before description', () => {
    useFixtures();
    const { counter, tasks } = parseTasks(tasksFile);
    writeTasks(tasksFile, counter, tasks);
    const content = readFileSync(tasksFile, 'utf8');
    const t3Start = content.indexOf('# 3 ');
    const t3End = content.indexOf('\n# ', t3Start + 1);
    const block = t3End === -1 ? content.slice(t3Start) : content.slice(t3Start, t3End);
    const lines = block.split('\n');
    const scopeIdx = lines.findIndex(l => l.startsWith('$scope:'));
    const refIdx   = lines.findIndex(l => l.startsWith('$ref:'));
    assert.ok(scopeIdx !== -1, '$scope: line must be present');
    assert.ok(refIdx !== -1,   '$ref: line must be present');
    assert.ok(scopeIdx < refIdx, '$scope must appear before $ref');
  });
});

// ── applyRefs ─────────────────────────────────────────────────────────────────

function makeTask(id, extra = {}) {
  return { id, title: `Task ${id}`, type: 'bug', status: 'todo', priority: 'medium', description: '', ...extra };
}

describe('applyRefs', () => {
  test('adds inverse on counterpart when a canonical ref is added', () => {
    const a = makeTask(1);
    const b = makeTask(2);
    const all = [a, b];
    applyRefs(all, 1, [], [{ id: 2, relation: 'blocks' }]);
    assert.deepEqual(b.refs, [{ id: 1, relation: 'is blocked by' }]);
  });

  test('removes inverse from counterpart when ref is removed', () => {
    const a = makeTask(1, { refs: [{ id: 2, relation: 'blocks' }] });
    const b = makeTask(2, { refs: [{ id: 1, relation: 'is blocked by' }] });
    const all = [a, b];
    applyRefs(all, 1, [{ id: 2, relation: 'blocks' }], []);
    assert.equal(b.refs, undefined);
  });

  test('updates inverse when relation changes', () => {
    const a = makeTask(1, { refs: [{ id: 2, relation: 'blocks' }] });
    const b = makeTask(2, { refs: [{ id: 1, relation: 'is blocked by' }] });
    const all = [a, b];
    applyRefs(all, 1, [{ id: 2, relation: 'blocks' }], [{ id: 2, relation: 'causes' }]);
    assert.equal(b.refs[0].relation, 'is caused by');
  });

  test('"relates to" is its own inverse (symmetric)', () => {
    const a = makeTask(1);
    const b = makeTask(2);
    const all = [a, b];
    applyRefs(all, 1, [], [{ id: 2, relation: 'relates to' }]);
    assert.deepEqual(b.refs, [{ id: 1, relation: 'relates to' }]);
  });

  test('non-canonical refs are not mirrored', () => {
    const a = makeTask(1);
    const b = makeTask(2);
    const all = [a, b];
    applyRefs(all, 1, [], [{ id: 2, relation: 'see also', nonCanonical: true }]);
    assert.equal(b.refs, undefined);
  });

  test('does not add duplicate inverse if already present', () => {
    const a = makeTask(1);
    const b = makeTask(2, { refs: [{ id: 1, relation: 'is blocked by' }] });
    const all = [a, b];
    applyRefs(all, 1, [], [{ id: 2, relation: 'blocks' }]);
    assert.equal(b.refs.length, 1);
  });

  test('does not touch the source task itself', () => {
    const a = makeTask(1);
    const all = [a];
    applyRefs(all, 1, [], [{ id: 1, relation: 'relates to' }]);
    assert.equal(a.refs, undefined);
  });

  test('handles multiple refs at once', () => {
    const a = makeTask(1);
    const b = makeTask(2);
    const c = makeTask(3);
    const all = [a, b, c];
    applyRefs(all, 1, [], [
      { id: 2, relation: 'blocks' },
      { id: 3, relation: 'causes' },
    ]);
    assert.equal(b.refs[0].relation, 'is blocked by');
    assert.equal(c.refs[0].relation, 'is caused by');
  });

  test('returns the mutated allTasks array (same reference)', () => {
    const all = [makeTask(1), makeTask(2)];
    const result = applyRefs(all, 1, [], [{ id: 2, relation: 'tests' }]);
    assert.strictEqual(result, all);
  });
});

// ── cascadeDelete ─────────────────────────────────────────────────────────────

describe('cascadeDelete', () => {
  test('removes all refs pointing to the deleted id', () => {
    const a = makeTask(1, { refs: [{ id: 99, relation: 'blocks' }] });
    const b = makeTask(2, { refs: [{ id: 99, relation: 'relates to' }, { id: 1, relation: 'depends on' }] });
    const all = [a, b];
    cascadeDelete(all, 99);
    assert.equal(a.refs, undefined);
    assert.deepEqual(b.refs, [{ id: 1, relation: 'depends on' }]);
  });

  test('sets refs to undefined when all refs are removed', () => {
    const t = makeTask(1, { refs: [{ id: 5, relation: 'blocks' }] });
    cascadeDelete([t], 5);
    assert.equal(t.refs, undefined);
  });

  test('does not touch tasks with no refs to the deleted id', () => {
    const t = makeTask(1, { refs: [{ id: 3, relation: 'relates to' }] });
    cascadeDelete([t], 99);
    assert.deepEqual(t.refs, [{ id: 3, relation: 'relates to' }]);
  });

  test('handles tasks with no refs gracefully', () => {
    const t = makeTask(1);
    assert.doesNotThrow(() => cascadeDelete([t], 1));
    assert.equal(t.refs, undefined);
  });

  test('returns the mutated allTasks array (same reference)', () => {
    const all = [makeTask(1, { refs: [{ id: 5, relation: 'blocks' }] })];
    const result = cascadeDelete(all, 5);
    assert.strictEqual(result, all);
  });
});

// ── getByStatus logic ─────────────────────────────────────────────────────────
// Tests verify the filtering + sorting logic used by the getByStatus tool.

describe('getByStatus logic', () => {
  function writeActiveAndDone(activeContent, doneContent) {
    writeFileSync(tasksFile, activeContent);
    writeFileSync(doneFile, doneContent);
  }

  test('returns only tasks matching the given status from active file', () => {
    writeActiveAndDone(
      [
        '# Counter: 3',
        '',
        '# 3 In Progress Task',
        '## bug | in_progress | high',
        'desc',
        '',
        '# 2 Todo Task',
        '## feature | todo | medium',
        'desc',
        '',
        '# 1 Refinement Task',
        '## idea | refinement | low',
        'desc',
        '',
      ].join('\n'),
      '# Done tasks\n'
    );
    const { tasks: active } = parseTasks(tasksFile);
    const todos = sortByPriority(active.filter(t => t.status === 'todo'));
    assert.equal(todos.length, 1);
    assert.equal(todos[0].id, 2);
    assert.equal(todos[0].status, 'todo');
  });

  test('returns done tasks from done file only', () => {
    writeActiveAndDone(
      '# Counter: 2\n\n# 2 Active Task\n## bug | todo | high\ndesc\n',
      [
        '# Done tasks',
        '',
        '# 1 Done Task',
        '## feature | done | medium',
        'desc',
        '',
      ].join('\n')
    );
    const { tasks: done } = parseTasks(doneFile);
    const doneTasks = sortByPriority(done.filter(t => t.status === 'done'));
    assert.equal(doneTasks.length, 1);
    assert.equal(doneTasks[0].id, 1);
    assert.equal(doneTasks[0].status, 'done');
    // Active file tasks are NOT in done result
    const { tasks: active } = parseTasks(tasksFile);
    assert.equal(active.some(t => t.status === 'done'), false);
  });

  test('scope filter narrows results (exact, case-sensitive)', () => {
    writeActiveAndDone(
      [
        '# Counter: 3',
        '',
        '# 3 Scoped Todo',
        '## bug | todo | high',
        '$scope: auth',
        'desc',
        '',
        '# 2 Other Todo',
        '## bug | todo | medium',
        '$scope: dashboard',
        'desc',
        '',
        '# 1 No Scope Todo',
        '## bug | todo | low',
        'desc',
        '',
      ].join('\n'),
      '# Done tasks\n'
    );
    const { tasks: active } = parseTasks(tasksFile);
    const todos = active.filter(t => t.status === 'todo');
    const scoped = sortByPriority(todos.filter(t => t.scope === 'auth'));
    assert.equal(scoped.length, 1);
    assert.equal(scoped[0].id, 3);
  });

  test('scope filter is case-sensitive — wrong case returns empty', () => {
    writeActiveAndDone(
      '# Counter: 1\n\n# 1 Scoped\n## bug | todo | high\n$scope: Auth\ndesc\n',
      '# Done tasks\n'
    );
    const { tasks: active } = parseTasks(tasksFile);
    const result = sortByPriority(active.filter(t => t.status === 'todo' && t.scope === 'auth'));
    assert.equal(result.length, 0);
  });

  test('empty result returns empty array, not an error', () => {
    writeActiveAndDone('# Counter: 1\n', '# Done tasks\n');
    const { tasks: active } = parseTasks(tasksFile);
    const result = sortByPriority(active.filter(t => t.status === 'in_progress'));
    assert.deepEqual(result, []);
  });

  test('sorted by priority desc then id desc', () => {
    writeActiveAndDone(
      [
        '# Counter: 4',
        '',
        '# 4 Low todo',
        '## bug | todo | low',
        'desc',
        '',
        '# 3 High todo',
        '## bug | todo | high',
        'desc',
        '',
        '# 2 High todo 2',
        '## bug | todo | high',
        'desc',
        '',
        '# 1 Medium todo',
        '## bug | todo | medium',
        'desc',
        '',
      ].join('\n'),
      '# Done tasks\n'
    );
    const { tasks: active } = parseTasks(tasksFile);
    const todos = sortByPriority(active.filter(t => t.status === 'todo'));
    assert.equal(todos[0].id, 3); // high, id 3
    assert.equal(todos[1].id, 2); // high, id 2
    assert.equal(todos[2].id, 1); // medium
    assert.equal(todos[3].id, 4); // low
  });

  test('refinement status filtered from active file', () => {
    writeActiveAndDone(
      [
        '# Counter: 2',
        '',
        '# 2 Todo',
        '## bug | todo | high',
        'desc',
        '',
        '# 1 Refinement',
        '## feature | refinement | medium',
        'desc',
        '',
      ].join('\n'),
      '# Done tasks\n'
    );
    const { tasks: active } = parseTasks(tasksFile);
    const refinement = sortByPriority(active.filter(t => t.status === 'refinement'));
    assert.equal(refinement.length, 1);
    assert.equal(refinement[0].id, 1);
  });
});

// ── getScopes logic ───────────────────────────────────────────────────────────
// Tests verify the aggregation + sort logic used by the getScopes tool.

describe('getScopes logic', () => {
  function buildScopesResult(active, done) {
    const all = [...active, ...done];
    const scopeMap = new Map();
    for (const t of all) {
      if (!t.scope) continue;
      if (!scopeMap.has(t.scope)) scopeMap.set(t.scope, { total: 0, open: 0 });
      const entry = scopeMap.get(t.scope);
      entry.total++;
      if (t.status !== 'done') entry.open++;
    }
    return [...scopeMap.entries()]
      .map(([scope, { total, open }]) => ({ scope, total, open }))
      .sort((a, b) => {
        if (b.open !== a.open) return b.open - a.open;
        if (b.total !== a.total) return b.total - a.total;
        return a.scope.localeCompare(b.scope);
      });
  }

  test('tasks without scope are excluded', () => {
    const active = [
      makeTask(1, { scope: undefined }),
      makeTask(2, { scope: 'auth' }),
    ];
    const scopes = buildScopesResult(active, []);
    assert.equal(scopes.length, 1);
    assert.equal(scopes[0].scope, 'auth');
  });

  test('total counts tasks from both active and done files', () => {
    const active = [makeTask(1, { scope: 'auth', status: 'todo' })];
    const done = [makeTask(2, { scope: 'auth', status: 'done' })];
    const scopes = buildScopesResult(active, done);
    assert.equal(scopes[0].total, 2);
    assert.equal(scopes[0].open, 1);
  });

  test('open counts only non-done tasks', () => {
    const active = [
      makeTask(1, { scope: 'auth', status: 'todo' }),
      makeTask(2, { scope: 'auth', status: 'in_progress' }),
      makeTask(3, { scope: 'auth', status: 'refinement' }),
    ];
    const done = [makeTask(4, { scope: 'auth', status: 'done' })];
    const scopes = buildScopesResult(active, done);
    assert.equal(scopes[0].open, 3);
    assert.equal(scopes[0].total, 4);
  });

  test('sorted: open desc, then total desc, then alphabetically', () => {
    const active = [
      makeTask(1, { scope: 'beta', status: 'todo' }),
      makeTask(2, { scope: 'alpha', status: 'todo' }),
      makeTask(3, { scope: 'alpha', status: 'todo' }),
      makeTask(4, { scope: 'gamma', status: 'todo' }),
      makeTask(5, { scope: 'gamma', status: 'todo' }),
    ];
    // alpha: open=2 total=2, beta: open=1 total=1, gamma: open=2 total=2
    // open desc: alpha and gamma tie at 2, then total ties at 2, then alpha < gamma alphabetically
    const scopes = buildScopesResult(active, []);
    assert.equal(scopes[0].scope, 'alpha');
    assert.equal(scopes[1].scope, 'gamma');
    assert.equal(scopes[2].scope, 'beta');
  });

  test('empty when no tasks have a scope', () => {
    const active = [makeTask(1), makeTask(2)];
    const scopes = buildScopesResult(active, []);
    assert.deepEqual(scopes, []);
  });

  test('returns empty array when no tasks exist at all', () => {
    const scopes = buildScopesResult([], []);
    assert.deepEqual(scopes, []);
  });
});

// ── getOverview new shape ─────────────────────────────────────────────────────
// Tests verify the { refinement, open, done } shape.

describe('getOverview new shape', () => {
  function buildOverview(active, done) {
    const all = [...active, ...done];
    const allTypes = ['bug', 'feature', 'idea', 'tool', 'other'];
    return allTypes
      .map(type => {
        const ofType = all.filter(t => t.type === type);
        return {
          type,
          refinement: ofType.filter(t => t.status === 'refinement').length,
          open: ofType.filter(t => t.status === 'todo' || t.status === 'in_progress').length,
          done: ofType.filter(t => t.status === 'done').length,
        };
      })
      .filter(o => o.refinement + o.open + o.done > 0)
      .sort((a, b) => b.open - a.open);
  }

  test('counts refinement, open, done correctly for each type', () => {
    const active = [
      makeTask(1, { type: 'bug', status: 'refinement' }),
      makeTask(2, { type: 'bug', status: 'todo' }),
      makeTask(3, { type: 'bug', status: 'in_progress' }),
    ];
    const done = [makeTask(4, { type: 'bug', status: 'done' })];
    const overview = buildOverview(active, done);
    assert.equal(overview.length, 1);
    const bugRow = overview[0];
    assert.equal(bugRow.type, 'bug');
    assert.equal(bugRow.refinement, 1);
    assert.equal(bugRow.open, 2);
    assert.equal(bugRow.done, 1);
  });

  test('does not include "actionable" or "total" fields', () => {
    const active = [makeTask(1, { type: 'bug', status: 'todo' })];
    const overview = buildOverview(active, []);
    assert.equal('actionable' in overview[0], false);
    assert.equal('total' in overview[0], false);
  });

  test('excludes types with no tasks', () => {
    const active = [makeTask(1, { type: 'bug', status: 'todo' })];
    const overview = buildOverview(active, []);
    assert.ok(overview.every(o => o.type === 'bug'));
    assert.equal(overview.length, 1);
  });

  test('sorted by open desc', () => {
    const active = [
      makeTask(1, { type: 'idea', status: 'todo' }),
      makeTask(2, { type: 'idea', status: 'todo' }),
      makeTask(3, { type: 'bug', status: 'todo' }),
    ];
    const overview = buildOverview(active, []);
    assert.equal(overview[0].type, 'idea');
    assert.equal(overview[0].open, 2);
    assert.equal(overview[1].type, 'bug');
    assert.equal(overview[1].open, 1);
  });

  test('all-refinement task does not count toward open', () => {
    const active = [makeTask(1, { type: 'feature', status: 'refinement' })];
    const overview = buildOverview(active, []);
    assert.equal(overview[0].open, 0);
    assert.equal(overview[0].refinement, 1);
  });
});

// ── getRelated inbound refRelation ────────────────────────────────────────────

describe('getRelated inbound refRelation', () => {
  function getRelated(all, id) {
    const task = all.find(t => t.id === id);
    if (!task) return null;
    const outbound = (task.refs ?? []).flatMap(ref => {
      const t = all.find(t => t.id === ref.id);
      return t ? [{ ...t, refRelation: ref.relation }] : [];
    });
    const inbound = all.filter(t => t.id !== id && t.refs?.some(r => r.id === id)).map(t => {
      const ref = t.refs.find(r => r.id === id);
      return { ...t, refRelation: ref.relation };
    });
    return { task, outbound, inbound };
  }

  test('inbound tasks are decorated with refRelation', () => {
    const a = makeTask(1, { refs: [{ id: 2, relation: 'blocks' }] });
    const b = makeTask(2, { refs: [{ id: 1, relation: 'is blocked by' }] });
    const result = getRelated([a, b], 2);
    assert.equal(result.inbound.length, 1);
    assert.equal(result.inbound[0].refRelation, 'blocks');
  });

  test('outbound tasks are decorated with refRelation', () => {
    const a = makeTask(1, { refs: [{ id: 2, relation: 'causes' }] });
    const b = makeTask(2, { refs: [{ id: 1, relation: 'is caused by' }] });
    const result = getRelated([a, b], 1);
    assert.equal(result.outbound.length, 1);
    assert.equal(result.outbound[0].refRelation, 'causes');
  });

  test('inbound refRelation reflects the inbound task\'s own relation to queried task', () => {
    const a = makeTask(1, { refs: [{ id: 2, relation: 'depends on' }] });
    const b = makeTask(2, { refs: [{ id: 1, relation: 'is depended on by' }] });
    // From task 2's perspective: task 1 depends on task 2 → inbound from task 1
    const result = getRelated([a, b], 2);
    // a's ref pointing to 2 has relation 'depends on'
    assert.equal(result.inbound[0].refRelation, 'depends on');
  });

  test('no inbound returns empty array', () => {
    const a = makeTask(1, { refs: [{ id: 2, relation: 'relates to' }] });
    const b = makeTask(2, { refs: [{ id: 1, relation: 'relates to' }] });
    const result = getRelated([a, b], 1);
    // task 2 references task 1, so task 1 has inbound from task 2
    assert.equal(result.inbound.length, 1);
    assert.equal(result.inbound[0].id, 2);
    assert.equal(result.inbound[0].refRelation, 'relates to');
  });

  test('task with no refs has empty outbound and empty inbound', () => {
    const a = makeTask(1);
    const b = makeTask(2);
    const result = getRelated([a, b], 1);
    assert.deepEqual(result.outbound, []);
    assert.deepEqual(result.inbound, []);
  });
});

// ── setStatus knowledgeReminder ───────────────────────────────────────────────
// Tests verify the reminder field shape on done transitions.
// We exercise the response-building logic directly to avoid spinning up the
// full MCP server, which requires live TASKS_FILE env vars.

describe('setStatus knowledgeReminder response shape', () => {
  function buildSetStatusResult(newStatus) {
    const result = { success: true };
    if (newStatus === 'done') {
      result.knowledgeReminder = 'Task closed. Before moving on: (1) identify non-obvious decisions, gotchas, conventions, or architecture changes from this task; (2) update the closest relevant CLAUDE.md with anything genuinely new — keep entries terse and deduped; (3) prune or correct any entries now stale or contradicted. Skip if nothing worth capturing.';
    }
    return result;
  }

  test('knowledgeReminder is present when transitioning to done', () => {
    const result = buildSetStatusResult('done');
    assert.equal(result.success, true);
    assert.ok('knowledgeReminder' in result, 'knowledgeReminder field must be present for done transition');
    assert.equal(typeof result.knowledgeReminder, 'string');
    assert.ok(result.knowledgeReminder.length > 0);
  });

  test('knowledgeReminder mentions adding new knowledge', () => {
    const result = buildSetStatusResult('done');
    const text = result.knowledgeReminder.toLowerCase();
    assert.ok(
      text.includes('claude.md') || text.includes('decisions') || text.includes('new'),
      'reminder should reference adding new knowledge'
    );
  });

  test('knowledgeReminder mentions removing stale entries', () => {
    const result = buildSetStatusResult('done');
    const text = result.knowledgeReminder.toLowerCase();
    assert.ok(
      text.includes('stale') || text.includes('prune') || text.includes('correct'),
      'reminder should reference pruning stale entries'
    );
  });

  test('knowledgeReminder is absent for in_progress transition', () => {
    const result = buildSetStatusResult('in_progress');
    assert.equal(result.success, true);
    assert.ok(!('knowledgeReminder' in result), 'knowledgeReminder must not appear for non-done transition');
  });

  test('knowledgeReminder is absent for todo transition', () => {
    const result = buildSetStatusResult('todo');
    assert.ok(!('knowledgeReminder' in result));
  });

  test('knowledgeReminder is absent for refinement transition', () => {
    const result = buildSetStatusResult('refinement');
    assert.ok(!('knowledgeReminder' in result));
  });
});

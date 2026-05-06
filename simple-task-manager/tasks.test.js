import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseTasks,
  writeTasks,
  writeDoneTasks,
  sortByPriority,
  sortForNext,
  wrapLines,
} from './tasks.js';

let dir;
let tasksFile;
let doneFile;

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

  test('parses counter and a single task', () => {
    writeFileSync(tasksFile, [
      '# Counter: 3',
      '',
      '# 3 Fix the bug',
      '## bug | todo | high',
      'Some description here.',
      '',
    ].join('\n'));

    const { counter, tasks } = parseTasks(tasksFile);
    assert.equal(counter, 3);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, 3);
    assert.equal(tasks[0].title, 'Fix the bug');
    assert.equal(tasks[0].type, 'bug');
    assert.equal(tasks[0].status, 'todo');
    assert.equal(tasks[0].priority, 'high');
    assert.equal(tasks[0].description, 'Some description here.');
  });

  test('parses multiple tasks in correct order', () => {
    writeFileSync(tasksFile, [
      '# Counter: 5',
      '',
      '# 5 Second task',
      '## feature | in_progress | medium',
      '',
      '# 2 First task',
      '## idea | done | low',
      'Idea details.',
      '',
    ].join('\n'));

    const { tasks } = parseTasks(tasksFile);
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].id, 5);
    assert.equal(tasks[1].id, 2);
  });

  test('parses task with empty description', () => {
    writeFileSync(tasksFile, [
      '# Counter: 1',
      '',
      '# 1 No description',
      '## tool | todo | critical',
      '',
    ].join('\n'));

    const { tasks } = parseTasks(tasksFile);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].description, '');
  });

  test('parses task with multiline description', () => {
    writeFileSync(tasksFile, [
      '# Counter: 1',
      '',
      '# 1 Multi',
      '## other | todo | low',
      'Line one.',
      'Line two.',
      '',
      'After blank.',
      '',
    ].join('\n'));

    const { tasks } = parseTasks(tasksFile);
    assert.equal(tasks[0].description, 'Line one.\nLine two.\n\nAfter blank.');
  });

  test('skips task with invalid metadata and continues parsing', () => {
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

  test('returns counter 0 when no counter line present', () => {
    writeFileSync(tasksFile, [
      '# 1 A task',
      '## bug | todo | high',
      '',
    ].join('\n'));

    const { counter } = parseTasks(tasksFile);
    assert.equal(counter, 0);
  });
});

// ── writeTasks ─────────────────────────────────────────────────────────────────

describe('writeTasks', () => {
  test('round-trips a task through write + parse', () => {
    const tasks = [{
      id: 7,
      title: 'Round trip',
      type: 'feature',
      priority: 'medium',
      status: 'todo',
      description: 'Some details.',
    }];

    writeTasks(tasksFile, 7, tasks);
    const { counter, tasks: parsed } = parseTasks(tasksFile);
    assert.equal(counter, 7);
    assert.equal(parsed.length, 1);
    assert.deepEqual(parsed[0], tasks[0]);
  });

  test('sorts tasks by id descending', () => {
    const tasks = [
      { id: 1, title: 'A', type: 'bug', priority: 'low', status: 'todo', description: '' },
      { id: 5, title: 'B', type: 'bug', priority: 'low', status: 'todo', description: '' },
      { id: 3, title: 'C', type: 'bug', priority: 'low', status: 'todo', description: '' },
    ];

    writeTasks(tasksFile, 5, tasks);
    const { tasks: parsed } = parseTasks(tasksFile);
    assert.deepEqual(parsed.map(t => t.id), [5, 3, 1]);
  });

  test('writes atomically via .tmp file (tmp is gone after write)', () => {
    writeTasks(tasksFile, 0, []);
    const tmpExists = (() => {
      try { readFileSync(tasksFile + '.tmp'); return true; } catch { return false; }
    })();
    assert.equal(tmpExists, false);
    assert.ok(readFileSync(tasksFile, 'utf8').startsWith('# Counter:'));
  });

  test('skips description block when empty', () => {
    writeTasks(tasksFile, 1, [{
      id: 1, title: 'No desc', type: 'other', priority: 'low', status: 'todo', description: ''
    }]);
    const content = readFileSync(tasksFile, 'utf8');
    assert.ok(!content.includes('\n\n\n'));
  });
});

// ── writeDoneTasks ─────────────────────────────────────────────────────────────

describe('writeDoneTasks', () => {
  test('round-trips done tasks through write + parse', () => {
    const tasks = [{
      id: 4,
      title: 'Done thing',
      type: 'tool',
      priority: 'high',
      status: 'done',
      description: 'Completed.',
    }];

    writeDoneTasks(doneFile, tasks);
    const { tasks: parsed } = parseTasks(doneFile);
    assert.equal(parsed.length, 1);
    assert.deepEqual(parsed[0], tasks[0]);
  });

  test('writes header line', () => {
    writeDoneTasks(doneFile, []);
    const content = readFileSync(doneFile, 'utf8');
    assert.ok(content.startsWith('# Done tasks'));
  });
});

// ── sortByPriority ─────────────────────────────────────────────────────────────

describe('sortByPriority', () => {
  const make = (id, priority) => ({ id, priority, title: '', type: 'bug', status: 'todo', description: '' });

  test('sorts critical before high before medium before low', () => {
    const tasks = [make(1, 'low'), make(2, 'high'), make(3, 'critical'), make(4, 'medium')];
    const sorted = sortByPriority(tasks);
    assert.deepEqual(sorted.map(t => t.priority), ['critical', 'high', 'medium', 'low']);
  });

  test('breaks priority ties by id descending (FILO)', () => {
    const tasks = [make(1, 'high'), make(3, 'high'), make(2, 'high')];
    const sorted = sortByPriority(tasks);
    assert.deepEqual(sorted.map(t => t.id), [3, 2, 1]);
  });

  test('does not mutate the input array', () => {
    const tasks = [make(1, 'low'), make(2, 'high')];
    const original = [...tasks];
    sortByPriority(tasks);
    assert.deepEqual(tasks, original);
  });
});

// ── sortForNext ────────────────────────────────────────────────────────────────

describe('sortForNext', () => {
  const make = (id, status, priority) => ({ id, status, priority, title: '', type: 'bug', description: '' });

  test('puts in_progress before todo', () => {
    const tasks = [make(1, 'todo', 'critical'), make(2, 'in_progress', 'low')];
    const sorted = sortForNext(tasks);
    assert.equal(sorted[0].id, 2);
  });

  test('within same status, sorts by priority desc then id desc', () => {
    const tasks = [
      make(1, 'todo', 'low'),
      make(3, 'todo', 'high'),
      make(2, 'todo', 'high'),
    ];
    const sorted = sortForNext(tasks);
    assert.deepEqual(sorted.map(t => t.id), [3, 2, 1]);
  });

  test('does not mutate the input array', () => {
    const tasks = [make(1, 'todo', 'high'), make(2, 'in_progress', 'low')];
    const original = [...tasks];
    sortForNext(tasks);
    assert.deepEqual(tasks, original);
  });
});

// ── update round-trip (write → parse → patch → write → parse) ─────────────────

describe('update round-trip', () => {
  test('patching title and description persists correctly', () => {
    const original = {
      id: 10, title: 'Original title', type: 'bug',
      priority: 'high', status: 'todo', description: 'Old description.'
    };
    writeTasks(tasksFile, 10, [original]);

    // Simulate what the update tool does
    const { counter, tasks } = parseTasks(tasksFile);
    const task = tasks.find(t => t.id === 10);
    task.title = 'Updated title';
    task.description = 'New description.';
    writeTasks(tasksFile, counter, tasks.map(t => (t.id === 10 ? task : t)));

    const { tasks: result } = parseTasks(tasksFile);
    assert.equal(result[0].title, 'Updated title');
    assert.equal(result[0].description, 'New description.');
    assert.equal(result[0].priority, 'high'); // unchanged
    assert.equal(result[0].type, 'bug');       // unchanged
  });

  test('patching priority and type persists correctly', () => {
    const original = {
      id: 11, title: 'Some task', type: 'idea',
      priority: 'low', status: 'todo', description: ''
    };
    writeTasks(tasksFile, 11, [original]);

    const { counter, tasks } = parseTasks(tasksFile);
    const task = tasks.find(t => t.id === 11);
    task.priority = 'critical';
    task.type = 'feature';
    writeTasks(tasksFile, counter, tasks.map(t => (t.id === 11 ? task : t)));

    const { tasks: result } = parseTasks(tasksFile);
    assert.equal(result[0].priority, 'critical');
    assert.equal(result[0].type, 'feature');
    assert.equal(result[0].title, 'Some task'); // unchanged
  });

  test('update on done task writes to done file', () => {
    const original = {
      id: 12, title: 'Done task', type: 'tool',
      priority: 'medium', status: 'done', description: 'Finished.'
    };
    writeDoneTasks(doneFile, [original]);

    const { tasks: done } = parseTasks(doneFile);
    const task = done.find(t => t.id === 12);
    task.title = 'Renamed done task';
    writeDoneTasks(doneFile, done.map(t => (t.id === 12 ? task : t)));

    const { tasks: result } = parseTasks(doneFile);
    assert.equal(result[0].title, 'Renamed done task');
  });
});

// ── wrapLines ─────────────────────────────────────────────────────────────────

describe('wrapLines', () => {
  test('passes short lines through unchanged', () => {
    assert.equal(wrapLines('short line', 120), 'short line');
  });

  test('wraps long line at whitespace', () => {
    const long = 'word '.repeat(30).trim(); // 149 chars
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
});

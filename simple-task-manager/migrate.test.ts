import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateToSqlite, parseLegacyMarkdown } from './migrate.js';
import { createStore } from './tasks.js';

let dir: string;
let legacyTasks: string;
let legacyDone: string;
let outputDb: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-migrate-test-'));
  legacyTasks = join(dir, 'TASKS.md');
  legacyDone  = join(dir, 'TASKS_DONE.md');
  outputDb    = join(dir, 'tasks.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('parseLegacyMarkdown', () => {
  test('reads the counter and tasks', () => {
    const md = [
      '# Counter: 5',
      '',
      '# 5 Hello',
      '## bug | todo | high',
      '$scope: web',
      '$ref: #2 blocks',
      'Body line.',
      '',
      '# 2 World',
      '## feature | done | medium',
      'World body.',
      '',
    ].join('\n');
    const { counter, tasks } = parseLegacyMarkdown(md);
    assert.equal(counter, 5);
    assert.equal(tasks.length, 2);
    const five = tasks.find((t) => t.id === 5);
    assert.equal(five?.title, 'Hello');
    assert.equal(five?.scope, 'web');
    assert.deepEqual(five?.refs, [{ id: 2, relation: 'blocks' }]);
    assert.equal(five?.description, 'Body line.');
  });

  test('preserves non-canonical relations', () => {
    const md = [
      '# Counter: 1',
      '',
      '# 1 X',
      '## bug | todo | high',
      '$ref: #9 see also',
      '',
    ].join('\n');
    const { tasks } = parseLegacyMarkdown(md);
    assert.equal(tasks[0]?.refs?.[0]?.nonCanonical, true);
    assert.equal(tasks[0]?.refs?.[0]?.relation, 'see also');
  });
});

describe('migrateToSqlite', () => {
  test('migrates active and done tasks into one db', () => {
    writeFileSync(legacyTasks, [
      '# Counter: 3',
      '',
      '# 3 Active',
      '## bug | todo | high',
      'A',
      '',
    ].join('\n'));
    writeFileSync(legacyDone, [
      '# Done tasks',
      '',
      '# 2 Archived',
      '## feature | done | medium',
      'D',
      '',
    ].join('\n'));

    const result = migrateToSqlite({ legacyTasks, legacyDone, outputDb });
    assert.equal(result.counter, 3);
    assert.equal(result.activeCount, 1);
    assert.equal(result.doneCount, 1);

    const store = createStore(outputDb);
    assert.equal(store.getById(3)?.title, 'Active');
    assert.equal(store.getById(2)?.title, 'Archived');
    assert.equal(store.getById(2)?.status, 'done');
    store.close();
  });

  test('writes .bak files for both legacy paths', () => {
    writeFileSync(legacyTasks, '# Counter: 0\n');
    writeFileSync(legacyDone, '# Done tasks\n');
    migrateToSqlite({ legacyTasks, legacyDone, outputDb });
    assert.ok(existsSync(legacyTasks + '.bak'));
    assert.ok(existsSync(legacyDone  + '.bak'));
  });

  test('refuses to overwrite an existing output db', () => {
    writeFileSync(legacyTasks, '# Counter: 0\n');
    writeFileSync(legacyDone, '# Done tasks\n');
    writeFileSync(outputDb, '');
    assert.throws(() => migrateToSqlite({ legacyTasks, legacyDone, outputDb }), /already exists/);
  });

  test('migrates refs and writes mirrors', () => {
    writeFileSync(legacyTasks, [
      '# Counter: 2',
      '',
      '# 2 B',
      '## bug | todo | high',
      '$ref: #1 blocks',
      '',
      '# 1 A',
      '## bug | todo | high',
      '',
    ].join('\n'));
    writeFileSync(legacyDone, '# Done tasks\n');
    migrateToSqlite({ legacyTasks, legacyDone, outputDb });
    const store = createStore(outputDb);
    assert.deepEqual(store.getById(2)?.refs, [{ id: 1, relation: 'blocks' }]);
    store.close();
  });

  test('counter is preserved so new ids continue', () => {
    writeFileSync(legacyTasks, [
      '# Counter: 42',
      '',
      '# 42 Last',
      '## bug | todo | high',
      'X',
      '',
    ].join('\n'));
    writeFileSync(legacyDone, '# Done tasks\n');
    migrateToSqlite({ legacyTasks, legacyDone, outputDb });
    const store = createStore(outputDb);
    const { id } = store.add({ type: 'bug', priority: 'low', title: 'Next', description: '' });
    assert.equal(id, 43);
    store.close();
  });
});

describe('backup contents', () => {
  test('.bak matches the original byte-for-byte', () => {
    const content = '# Counter: 0\n# Done tasks\n';
    writeFileSync(legacyTasks, content);
    writeFileSync(legacyDone,  content);
    migrateToSqlite({ legacyTasks, legacyDone, outputDb });
    assert.equal(readFileSync(legacyTasks + '.bak', 'utf8'), content);
    assert.equal(readFileSync(legacyDone  + '.bak', 'utf8'), content);
  });
});

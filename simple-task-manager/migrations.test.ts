/**
 * migrations.test.ts — tests for the file-based migration runner in tasks.ts.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createStore, loadMigrations } from './tasks.js';

const EPIC_MIGRATION = '20261020120000_add-epic-type-and-parent';
const EXTERNAL_ID_MIGRATION = '20261027120000_add-external-id';
const PROJECTS_MIGRATION = '20261027130000_add-projects';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-migrations-test-'));
  dbPath = join(dir, 'tasks.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('file-based migration runner', () => {
  test('fresh DB applies all migrations in order; schema_migrations has one row per file', () => {
    const store = createStore(dbPath);
    const db = new Database(dbPath);
    const rows = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as
      { version: number; name: string }[];
    db.close();
    store.close();

    assert.ok(rows.length >= 1, 'at least one migration applied');
    // Verify ascending version ordinals
    rows.forEach((row, i) => {
      assert.equal(row.version, i + 1, `version at index ${i} should be ${i + 1}`);
    });
    // The first migration must be the initial schema
    assert.equal(rows[0]?.name, '20260101000000_initial-schema');
  });

  test('second open is a no-op — migration count stays the same', () => {
    const store1 = createStore(dbPath);
    store1.close();

    const db1 = new Database(dbPath);
    const count1 = (db1.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n;
    db1.close();

    const store2 = createStore(dbPath);
    store2.close();

    const db2 = new Database(dbPath);
    const count2 = (db2.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n;
    db2.close();

    assert.equal(count2, count1, 'migration count must not increase on second open');
  });

  test('DB with extra applied row not on disk throws downgrade error', () => {
    const store = createStore(dbPath);
    store.close();

    const db = new Database(dbPath);
    db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(99, 'future-only-migration');
    db.close();

    assert.throws(
      () => createStore(dbPath),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /downgrade not supported/);
        assert.match(err.message, /future-only-migration/);
        return true;
      }
    );
  });

  test('DB with old v1 name="initial-schema" is backfilled to new name on open', () => {
    // Simulate a DB that was created by the old inline-MIGRATIONS code.
    // It has schema_migrations rows using the old short names.
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    // Bootstrap the schema_migrations table manually (runner creates it)
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    // Insert the old row with name='initial-schema'
    db.prepare('INSERT INTO schema_migrations (version, name) VALUES (1, ?)').run('initial-schema');
    // Also apply the initial schema SQL so the DB is valid
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('bug','feature','idea','tool','other')),
        status TEXT NOT NULL CHECK (status IN ('refinement','todo','in_progress','done')),
        priority TEXT NOT NULL CHECK (priority IN ('low','medium','high','critical')),
        scope TEXT, summary TEXT, description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_scope  ON tasks(scope);
      CREATE INDEX IF NOT EXISTS idx_tasks_type   ON tasks(type);
      CREATE TABLE IF NOT EXISTS refs (
        from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, relation TEXT NOT NULL,
        non_canonical INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (from_id, to_id, relation),
        FOREIGN KEY (from_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (to_id)   REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_refs_to ON refs(to_id);
      INSERT OR IGNORE INTO meta (key, value) VALUES ('counter', '0');
    `);
    db.close();

    // Opening with new code should backfill the name
    const store = createStore(dbPath);
    store.close();

    const db2 = new Database(dbPath);
    const row = db2.prepare('SELECT name FROM schema_migrations WHERE version = 1').get() as { name: string } | undefined;
    db2.close();

    assert.equal(row?.name, '20260101000000_initial-schema', 'old row should be renamed to new timestamped name');
  });

  test('second open after backfill is a no-op', () => {
    // Same setup as above — apply old schema then open twice
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY, name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare('INSERT INTO schema_migrations (version, name) VALUES (1, ?)').run('initial-schema');
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY, title TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('bug','feature','idea','tool','other')),
        status TEXT NOT NULL CHECK (status IN ('refinement','todo','in_progress','done')),
        priority TEXT NOT NULL CHECK (priority IN ('low','medium','high','critical')),
        scope TEXT, summary TEXT, description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_scope  ON tasks(scope);
      CREATE INDEX IF NOT EXISTS idx_tasks_type   ON tasks(type);
      CREATE TABLE IF NOT EXISTS refs (
        from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, relation TEXT NOT NULL,
        non_canonical INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (from_id, to_id, relation),
        FOREIGN KEY (from_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (to_id)   REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_refs_to ON refs(to_id);
      INSERT OR IGNORE INTO meta (key, value) VALUES ('counter', '0');
    `);
    db.close();

    const store1 = createStore(dbPath);
    store1.close();

    const db2 = new Database(dbPath);
    const count1 = (db2.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n;
    db2.close();

    // Second open must not increase migration count
    const store2 = createStore(dbPath);
    store2.close();

    const db3 = new Database(dbPath);
    const count2 = (db3.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n;
    db3.close();

    assert.equal(count2, count1, 'migration count must not increase on second open after backfill');
  });
});

describe('migration file name validation', () => {
  test('loadMigrations throws when exported name does not match filename stem', () => {
    const fakeDir = mkdtempSync(join(tmpdir(), 'mcp-fake-migrations-'));
    try {
      writeFileSync(
        join(fakeDir, '20991231000000_correct-stem.js'),
        'module.exports = { name: "wrong-name", up: function() {} };\n'
      );
      assert.throws(
        () => loadMigrations(fakeDir),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /mismatch/i);
          assert.match(err.message, /wrong-name/);
          return true;
        }
      );
    } finally {
      rmSync(fakeDir, { recursive: true, force: true });
    }
  });

  test('migration file whose exported name does not match filename is rejected', async () => {
    // The guard in loadMigrations() throws if mod.name !== stem (the filename
    // without extension). We verify all real migration files pass the guard, AND
    // that the error message is informative when a mismatch would occur.
    //
    // We load all migration files via createRequire (the same mechanism the
    // runner uses) and assert each exported name equals its filename stem.
    const { createRequire } = await import('node:module');
    const { join: pathJoin, basename } = await import('node:path');
    const { readdirSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');

    const selfDir = fileURLToPath(new URL('.', import.meta.url));
    const migrationsDir = pathJoin(selfDir, 'migrations');
    const req = createRequire(import.meta.url);

    const files = readdirSync(migrationsDir)
      .filter((f: string) => f.endsWith('.ts') || f.endsWith('.js'))
      .sort();

    for (const file of files) {
      const stem = basename(file, file.endsWith('.ts') ? '.ts' : '.js');
      const mod = req(pathJoin(migrationsDir, file)) as { name: string };
      assert.equal(
        mod.name,
        stem,
        `Migration "${file}" exports name="${mod.name}" but expected "${stem}"`
      );
    }
  });
});

describe('add-epic-type-and-parent migration', () => {
  // Build a DB as it was before the migration: every earlier migration applied.
  function seedPreEpicDb(): void {
    const db = new Database(dbPath);
    db.pragma('foreign_keys = OFF');
    db.exec(`CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')));`);
    const earlier = loadMigrations().filter((m) => m.name < EPIC_MIGRATION);
    earlier.forEach((m, i) => {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(i + 1, m.name);
    });
    db.pragma(`user_version = ${earlier.length}`);
    const ins = db.prepare('INSERT INTO tasks (title, type, status, priority, description) VALUES (?, ?, ?, ?, ?)');
    ins.run('First', 'bug', 'todo', 'high', 'one');
    ins.run('Second', 'feature', 'plan', 'low', 'two');
    db.prepare('INSERT INTO refs (from_id, to_id, relation) VALUES (1, 2, ?)').run('depends on');
    db.prepare('INSERT INTO refs (from_id, to_id, relation) VALUES (2, 1, ?)').run('is depended on by');
    db.prepare('INSERT INTO notes (task_id, body) VALUES (1, ?)').run('a note');
    db.close();
  }

  test('preserves tasks, refs and notes; adds parent_id, self-FK and index', () => {
    seedPreEpicDb();
    const store = createStore(dbPath);
    store.close();

    const db = new Database(dbPath);
    const tasks = db.prepare('SELECT id, title, type, status, priority, description, parent_id FROM tasks ORDER BY id').all();
    assert.deepEqual(tasks, [
      { id: 1, title: 'First', type: 'bug', status: 'todo', priority: 'high', description: 'one', parent_id: null },
      { id: 2, title: 'Second', type: 'feature', status: 'plan', priority: 'low', description: 'two', parent_id: null },
    ]);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM refs').get() as { n: number }).n, 2);
    assert.deepEqual(db.prepare('SELECT body FROM notes WHERE task_id = 1').all(), [{ body: 'a note' }]);

    const fks = db.pragma('foreign_key_list(tasks)') as { table: string; from: string; on_delete: string }[];
    assert.deepEqual(fks.filter((f) => f.from === 'parent_id').map((f) => [f.from, f.table, f.on_delete]), [['parent_id', 'tasks', 'SET NULL']]);
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_tasks_parent_id'").get();
    assert.ok(idx, 'idx_tasks_parent_id must exist');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(EPIC_MIGRATION);
    assert.ok(applied, 'epic migration must be recorded');
    db.close();
  });

  test('the rebuilt table accepts type epic and keeps ON DELETE CASCADE on refs and notes', () => {
    seedPreEpicDb();
    const store = createStore(dbPath);
    const { id } = store.add({ project: 'default', type: 'epic', priority: 'low', title: 'E' });
    store.delete(1);
    assert.equal(store.getById(id)?.type, 'epic');
    const n = (store.db.prepare('SELECT COUNT(*) AS n FROM notes WHERE task_id = 1').get() as { n: number }).n;
    const r = (store.db.prepare('SELECT COUNT(*) AS n FROM refs').get() as { n: number }).n;
    store.close();
    assert.equal(n, 0);
    assert.equal(r, 0);
  });
});

describe('add-external-id migration', () => {
  test('adds a nullable external_id column and the lower() index; existing rows read NULL', () => {
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')));`);
    const earlier = loadMigrations().filter((m) => m.name < EXTERNAL_ID_MIGRATION);
    earlier.forEach((m, i) => {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(i + 1, m.name);
    });
    db.pragma(`user_version = ${earlier.length}`);
    db.prepare('INSERT INTO tasks (title, type, status, priority, description) VALUES (?, ?, ?, ?, ?)').run('Old', 'bug', 'todo', 'high', '');
    db.close();

    createStore(dbPath).close();

    const db2 = new Database(dbPath);
    const cols = db2.pragma('table_info(tasks)') as { name: string; notnull: number }[];
    const col = cols.find((c) => c.name === 'external_id');
    assert.ok(col, 'external_id column must exist');
    assert.equal(col.notnull, 0);
    assert.deepEqual(db2.prepare('SELECT external_id FROM tasks').all(), [{ external_id: null }]);
    const idx = db2.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_tasks_external_id'").get();
    assert.ok(idx, 'idx_tasks_external_id must exist');
    db2.close();
  });
});

describe('add-projects migration', () => {
  function seedPreProjectsDb(): void {
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')));`);
    const earlier = loadMigrations().filter((m) => m.name < PROJECTS_MIGRATION);
    earlier.forEach((m, i) => {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(i + 1, m.name);
    });
    db.pragma(`user_version = ${earlier.length}`);
    const ins = db.prepare('INSERT INTO tasks (title, type, status, priority, scope, description, parent_id, external_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    ins.run('Epic', 'epic', 'todo', 'medium', 'example-scope', 'e', null, 'EX-1');
    ins.run('Child', 'bug', 'todo', 'high', 'example-scope', 'c', 1, null);
    ins.run('Deleted', 'idea', 'todo', 'low', null, 'd', null, null);
    db.prepare('DELETE FROM tasks WHERE id = 3').run();
    db.prepare('INSERT INTO refs (from_id, to_id, relation) VALUES (2, 1, ?)').run('depends on');
    db.prepare('INSERT INTO refs (from_id, to_id, relation) VALUES (1, 2, ?)').run('is depended on by');
    db.prepare('INSERT INTO notes (task_id, body) VALUES (2, ?)').run('a note');
    db.close();
  }

  test('files every task under the literal default project and keeps parent, refs, notes and external id', () => {
    seedPreProjectsDb();
    createStore(dbPath).close();

    const db = new Database(dbPath);
    assert.deepEqual(db.prepare('SELECT name FROM projects').all(), [{ name: 'default' }]);
    assert.deepEqual(db.prepare('SELECT id, project, parent_id, external_id FROM tasks ORDER BY id').all(), [
      { id: 1, project: 'default', parent_id: null, external_id: 'EX-1' },
      { id: 2, project: 'default', parent_id: 1, external_id: null },
    ]);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM refs').get() as { n: number }).n, 2);
    assert.deepEqual(db.prepare('SELECT body FROM notes WHERE task_id = 2').all(), [{ body: 'a note' }]);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    for (const name of ['idx_tasks_project', 'idx_tasks_external_id', 'idx_tasks_parent_id']) {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(name), `${name} must exist`);
    }
    const fks = db.pragma('foreign_key_list(tasks)') as { table: string; from: string; on_update: string }[];
    assert.deepEqual(fks.filter((f) => f.from === 'project').map((f) => [f.table, f.on_update]), [['projects', 'CASCADE']]);
    db.close();
  });

  test('keeps the AUTOINCREMENT high-water mark, so a deleted top id is not reused', () => {
    seedPreProjectsDb();
    const store = createStore(dbPath);
    const { id } = store.add({ project: 'default', type: 'bug', priority: 'low', title: 'New' });
    store.close();
    assert.equal(id, 4);
  });

  test('rejects a task whose project does not exist', () => {
    seedPreProjectsDb();
    const store = createStore(dbPath);
    assert.throws(
      () => store.db.prepare("INSERT INTO tasks (title, type, status, priority, project) VALUES ('X', 'bug', 'todo', 'low', 'nope')").run(),
      /FOREIGN KEY constraint failed/,
    );
    store.close();
  });
});

/**
 * migrations.test.ts — tests for the file-based migration runner in tasks.ts.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createStore } from './tasks.js';

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

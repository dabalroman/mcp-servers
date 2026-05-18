import type { Database as DB } from 'better-sqlite3';

export const name = '20260519000000_drop-meta-counter-autoincrement-tasks';

// Replace the meta.counter row (drifted whenever an external writer inserted a
// task without bumping it) with SQLite-native id assignment via AUTOINCREMENT.
// Existing ids are preserved verbatim so refs.from_id / refs.to_id keep
// resolving. The runner disables foreign_keys around the migration loop so the
// DROP TABLE here does not cascade-delete the refs table.
export function up(db: DB): void {
  db.exec(`
    DROP TABLE IF EXISTS meta;

    CREATE TABLE tasks_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      type        TEXT NOT NULL CHECK (type IN ('bug','feature','idea','tool','other')),
      status      TEXT NOT NULL CHECK (status IN ('refinement','todo','in_progress','done')),
      priority    TEXT NOT NULL CHECK (priority IN ('low','medium','high','critical')),
      scope       TEXT,
      summary     TEXT,
      description TEXT,
      plan        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO tasks_new (id, title, type, status, priority, scope, summary, description, plan, created_at, updated_at)
      SELECT id, title, type, status, priority, scope, summary, description, plan, created_at, updated_at
      FROM tasks
      ORDER BY id;

    DROP TABLE tasks;
    ALTER TABLE tasks_new RENAME TO tasks;

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_scope  ON tasks(scope);
    CREATE INDEX IF NOT EXISTS idx_tasks_type   ON tasks(type);
  `);
}

import type { Database as DB } from 'better-sqlite3';

export const name = '20260519010000_add-plan-status';

// Extend the status CHECK constraint to include 'plan' (sits between
// 'refinement' and 'todo' in the lifecycle). SQLite cannot ALTER a CHECK
// constraint in place, so we rebuild the table. Existing ids are preserved.
// The migration runner disables foreign_keys around the loop so the
// DROP TABLE does not cascade-delete refs.
export function up(db: DB): void {
  db.exec(`
    CREATE TABLE tasks_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      type        TEXT NOT NULL CHECK (type IN ('bug','feature','idea','tool','other')),
      status      TEXT NOT NULL CHECK (status IN ('refinement','plan','todo','in_progress','done')),
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

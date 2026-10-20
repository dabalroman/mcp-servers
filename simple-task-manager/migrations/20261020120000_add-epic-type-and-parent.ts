import type { Database as DB } from 'better-sqlite3';

export const name = '20261020120000_add-epic-type-and-parent';

// Adds the 'epic' type and a nullable parent_id linking a task to its epic.
// Same rebuild as add-plan-status: SQLite can't ALTER a CHECK constraint, and
// the runner keeps FKs off so the DROP doesn't cascade into refs or notes.
// The self-FK is written as tasks(id), not tasks_new(id): it must resolve to
// the table once it has been renamed.
export function up(db: DB): void {
  db.exec(`
    CREATE TABLE tasks_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      type        TEXT NOT NULL CHECK (type IN ('bug','feature','idea','tool','other','epic')),
      status      TEXT NOT NULL CHECK (status IN ('refinement','plan','todo','in_progress','done')),
      priority    TEXT NOT NULL CHECK (priority IN ('low','medium','high','critical')),
      scope       TEXT,
      summary     TEXT,
      description TEXT,
      plan        TEXT,
      parent_id   INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO tasks_new (id, title, type, status, priority, scope, summary, description, plan, created_at, updated_at)
      SELECT id, title, type, status, priority, scope, summary, description, plan, created_at, updated_at
      FROM tasks
      ORDER BY id;

    DROP TABLE tasks;
    ALTER TABLE tasks_new RENAME TO tasks;

    CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_scope     ON tasks(scope);
    CREATE INDEX IF NOT EXISTS idx_tasks_type      ON tasks(type);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
  `);
}

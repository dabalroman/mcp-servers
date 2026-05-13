import type { Database as DB } from 'better-sqlite3';

export const name = '20260101000000_initial-schema';

export function up(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id          INTEGER PRIMARY KEY,
      title       TEXT NOT NULL,
      type        TEXT NOT NULL CHECK (type IN ('bug','feature','idea','tool','other')),
      status      TEXT NOT NULL CHECK (status IN ('refinement','todo','in_progress','done')),
      priority    TEXT NOT NULL CHECK (priority IN ('low','medium','high','critical')),
      scope       TEXT,
      summary     TEXT,
      description TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_scope  ON tasks(scope);
    CREATE INDEX IF NOT EXISTS idx_tasks_type   ON tasks(type);

    CREATE TABLE IF NOT EXISTS refs (
      from_id        INTEGER NOT NULL,
      to_id          INTEGER NOT NULL,
      relation       TEXT NOT NULL,
      non_canonical  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (from_id, to_id, relation),
      FOREIGN KEY (from_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (to_id)   REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_refs_to ON refs(to_id);

    INSERT OR IGNORE INTO meta (key, value) VALUES ('counter', '0');
  `);
}

import type { Database as DB } from 'better-sqlite3';

export const name = '20261012120000_add-notes';

export function up(db: DB): void {
  db.exec(`
    CREATE TABLE notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_notes_task_id ON notes(task_id);
  `);
}

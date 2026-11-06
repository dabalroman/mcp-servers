import type { Database as DB } from 'better-sqlite3';

export const name = '20261106140000_add-pr-deployed-status';

// Widen task_prs.status with 'deployed' (a merged PR whose automatic deploy
// succeeded). SQLite cannot ALTER a CHECK constraint, so the table is rebuilt.
export function up(db: DB): void {
  db.exec(`
    CREATE TABLE task_prs_new (
      task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      url        TEXT NOT NULL,
      number     INTEGER NOT NULL CHECK (number > 0),
      status     TEXT NOT NULL CHECK (status IN ('draft','open','closed','merged','deployed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (task_id, url)
    );

    INSERT INTO task_prs_new (task_id, url, number, status, created_at, updated_at)
      SELECT task_id, url, number, status, created_at, updated_at
      FROM task_prs
      ORDER BY rowid;

    DROP TABLE task_prs;
    ALTER TABLE task_prs_new RENAME TO task_prs;

    CREATE INDEX task_prs_number ON task_prs(number);
  `);
}

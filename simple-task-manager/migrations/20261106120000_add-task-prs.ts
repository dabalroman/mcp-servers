import type { Database as DB } from 'better-sqlite3';

export const name = '20261106120000_add-task-prs';

// Pull/merge requests of a task, one row per PR (a task can span repos or a
// reopened PR). The PK doubles as the task_id index. Status is whatever an
// agent last saw: nothing polls the git host.
// projects.track_prs only decides whether agents are told to record PRs; the
// table works in every project.
export function up(db: DB): void {
  db.exec(`
    CREATE TABLE task_prs (
      task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      url        TEXT NOT NULL,
      number     INTEGER NOT NULL CHECK (number > 0),
      status     TEXT NOT NULL CHECK (status IN ('draft','open','closed','merged')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (task_id, url)
    );
    ALTER TABLE projects ADD COLUMN track_prs INTEGER NOT NULL DEFAULT 0;
  `);
}

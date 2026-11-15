import type { Database as DB } from 'better-sqlite3';

export const name = '20261115120001_add-task-repo';

// A task's primary repo id from project_repos (#569); NULL = unassigned, so
// existing rows and projects without repos are unchanged.
export function up(db: DB): void {
  db.exec('ALTER TABLE tasks ADD COLUMN repo TEXT;');
}

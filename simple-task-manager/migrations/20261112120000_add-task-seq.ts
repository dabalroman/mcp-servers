import type { Database as DB } from 'better-sqlite3';

export const name = '20261112120000_add-task-seq';

// Execution step of an epic child among its siblings (10, 20, 30; equal = parallel group).
// No index: an epic has a handful of children, sorted in memory or by a parent_id lookup.
export function up(db: DB): void {
  db.exec('ALTER TABLE tasks ADD COLUMN seq INTEGER;');
}

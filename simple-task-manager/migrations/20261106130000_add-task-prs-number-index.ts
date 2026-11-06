import type { Database as DB } from 'better-sqlite3';

export const name = '20261106130000_add-task-prs-number-index';

// getByPr selects task_prs rows by PR number across all tasks; the PK only
// serves lookups by task_id.
export function up(db: DB): void {
  db.exec('CREATE INDEX task_prs_number ON task_prs(number)');
}

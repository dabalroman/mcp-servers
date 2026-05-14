import type { Database as DB } from 'better-sqlite3';

export const name = '20260514120000_add-plan-field';

export function up(db: DB): void {
  db.exec(`ALTER TABLE tasks ADD COLUMN plan TEXT;`);
}

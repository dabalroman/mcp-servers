import type { Database as DB } from 'better-sqlite3';

export const name = '20261027120000_add-external-id';

// Optional external tracker ticket ID (JIRA/Asana/…). Not unique: an epic and
// its children may share one. Lookups are case-insensitive, hence the lower() index.
export function up(db: DB): void {
  db.exec(`
    ALTER TABLE tasks ADD COLUMN external_id TEXT;
    CREATE INDEX idx_tasks_external_id ON tasks(lower(external_id));
  `);
}

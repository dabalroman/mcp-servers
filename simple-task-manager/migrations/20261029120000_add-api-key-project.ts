import type { Database as DB } from 'better-sqlite3';

export const name = '20261029120000_add-api-key-project';

// The default project a key's connection binds to when the request sends no
// X-Project. A suggestion, not a boundary: tools still take `project`. NULL for
// keys created before this migration; those need the header.
export function up(db: DB): void {
  db.exec(`ALTER TABLE api_keys ADD COLUMN project TEXT REFERENCES projects(name);`);
}

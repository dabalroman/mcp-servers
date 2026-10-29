import type { Database as DB } from 'better-sqlite3';

export const name = '20261028120000_add-api-keys';

// Bearer keys for /mcp. Only the SHA-256 of a key is stored. AUTOINCREMENT so
// a revoked key's id is never handed to a new key (revoke works by id).
export function up(db: DB): void {
  db.exec(`
    CREATE TABLE api_keys (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      label        TEXT NOT NULL,
      hash         TEXT NOT NULL UNIQUE,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at   TEXT
    );
  `);
}

import type { Database as DB } from 'better-sqlite3';

export const name = '20260513000001_refs-pk-simplify';

export function up(db: DB): void {
  db.exec(`
    CREATE TABLE refs_new (
      from_id       INTEGER NOT NULL,
      to_id         INTEGER NOT NULL,
      relation      TEXT NOT NULL,
      non_canonical INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (from_id, to_id),
      FOREIGN KEY (from_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (to_id)   REFERENCES tasks(id) ON DELETE CASCADE
    );
    INSERT OR REPLACE INTO refs_new SELECT from_id, to_id, relation, non_canonical FROM refs;
    DROP TABLE refs;
    ALTER TABLE refs_new RENAME TO refs;
    CREATE INDEX IF NOT EXISTS idx_refs_to ON refs(to_id);
  `);
}

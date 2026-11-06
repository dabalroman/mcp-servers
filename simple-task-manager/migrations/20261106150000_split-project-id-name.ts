import type { Database as DB } from 'better-sqlite3';

export const name = '20261106150000_split-project-id-name';

// Splits a project's identity (id: every FK, PROJECT_NAME, X-Project, URLs)
// from its display name. The id is the old name verbatim, so no binding moves.
// RENAME COLUMN rewrites the FK text in tasks and api_keys to projects(id), so
// tasks needs no rebuild. ADD COLUMN NOT NULL needs a default; the store always
// writes name. name is NOCASE like the old column, so processes still on the
// old build (WHERE name = ?) keep matching any spelling until restarted.
// api_keys is rebuilt for ON UPDATE CASCADE: without it, adoptDefaultProject
// failed with a key bound to 'default'. Its AUTOINCREMENT seq is restored like
// add-projects does, since revoke works by id.
export function up(db: DB): void {
  db.exec(`
    ALTER TABLE projects RENAME COLUMN name TO id;
    ALTER TABLE projects ADD COLUMN name TEXT NOT NULL DEFAULT '' COLLATE NOCASE;
    UPDATE projects SET name = id;
  `);

  const seq = db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'api_keys'`).get() as { seq: number } | undefined;
  db.exec(`
    CREATE TABLE api_keys_new (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      label        TEXT NOT NULL,
      hash         TEXT NOT NULL UNIQUE,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at   TEXT,
      project      TEXT REFERENCES projects(id) ON UPDATE CASCADE
    );

    INSERT INTO api_keys_new (id, label, hash, created_at, last_used_at, revoked_at, project)
      SELECT id, label, hash, created_at, last_used_at, revoked_at, project
      FROM api_keys
      ORDER BY id;

    DROP TABLE api_keys;
    ALTER TABLE api_keys_new RENAME TO api_keys;
  `);
  if (seq) {
    const now = db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'api_keys'`).get() as { seq: number } | undefined;
    db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'api_keys'`).run();
    db.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES ('api_keys', CAST(? AS INTEGER))`).run(Math.max(seq.seq, now?.seq ?? 0));
  }

  assertProjectFks(db);
}

// The upgrade relies on SQLite rewriting the FKs; throwing rolls the whole
// migration transaction back instead of leaving FKs on a non-unique column.
export function assertProjectFks(db: DB): void {
  for (const table of ['tasks', 'api_keys']) {
    const fks = db.pragma(`foreign_key_list(${table})`) as { table: string; from: string; to: string }[];
    const fk = fks.find((f) => f.from === 'project');
    if (fk?.table !== 'projects' || fk.to !== 'id') {
      throw new Error(`split-project-id-name: ${table}.project must reference projects(id), found ${fk ? `${fk.table}(${fk.to})` : 'no FK'}.`);
    }
  }
}

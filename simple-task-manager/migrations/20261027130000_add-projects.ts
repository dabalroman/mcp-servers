import type { Database as DB } from 'better-sqlite3';

export const name = '20261027130000_add-projects';

// Adds a project layer above scope. Every existing task lands in the literal
// project 'default'; the MCP later adopts it under its PROJECT_NAME
// (adoptDefaultProject). Never read env here: whichever process opens the DB
// first (UI or any MCP) runs this.
// Both name columns are NOCASE so 'Foo' and 'foo' are one project and filters
// match either spelling. ON UPDATE CASCADE makes a rename one UPDATE on projects.
// No default on tasks.project, so a store bug can't silently file into 'default'.
// DROP TABLE takes the tasks row of sqlite_sequence with it and the rebuild
// reseeds it from the highest surviving id, so it is restored afterwards:
// otherwise ids of deleted top tasks would be handed out again.
export function up(db: DB): void {
  const seq = db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'tasks'`).get() as { seq: number } | undefined;
  db.exec(`
    CREATE TABLE projects (
      name       TEXT PRIMARY KEY COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO projects (name) VALUES ('default');

    CREATE TABLE tasks_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      type        TEXT NOT NULL CHECK (type IN ('bug','feature','idea','tool','other','epic')),
      status      TEXT NOT NULL CHECK (status IN ('refinement','plan','todo','in_progress','done')),
      priority    TEXT NOT NULL CHECK (priority IN ('low','medium','high','critical')),
      scope       TEXT,
      summary     TEXT,
      description TEXT,
      plan        TEXT,
      parent_id   INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      external_id TEXT,
      project     TEXT NOT NULL COLLATE NOCASE REFERENCES projects(name) ON UPDATE CASCADE,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO tasks_new (id, title, type, status, priority, scope, summary, description, plan, parent_id, external_id, project, created_at, updated_at)
      SELECT id, title, type, status, priority, scope, summary, description, plan, parent_id, external_id, 'default', created_at, updated_at
      FROM tasks
      ORDER BY id;

    DROP TABLE tasks;
    ALTER TABLE tasks_new RENAME TO tasks;

    CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_scope       ON tasks(scope);
    CREATE INDEX IF NOT EXISTS idx_tasks_type        ON tasks(type);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent_id   ON tasks(parent_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_external_id ON tasks(lower(external_id));
    CREATE INDEX IF NOT EXISTS idx_tasks_project     ON tasks(project);
  `);
  if (seq) {
    const now = db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'tasks'`).get() as { seq: number } | undefined;
    db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'tasks'`).run();
    db.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES ('tasks', CAST(? AS INTEGER))`).run(Math.max(seq.seq, now?.seq ?? 0));
  }
}

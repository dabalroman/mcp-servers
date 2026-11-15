import type { Database as DB } from 'better-sqlite3';

export const name = '20261115120000_add-project-repos';

// Repo registry for multi-repo projects (#569): sibling repos, the contracts
// between them, and the extra repos a task edits. Additive only; a project
// without rows here behaves as before. Owner/consumer/touches ids are checked
// by the store, not by FKs: a composite FK into project_repos would fight the
// ON UPDATE CASCADE from projects(id).
export function up(db: DB): void {
  db.exec(`
    CREATE TABLE project_repos (
      project    TEXT NOT NULL COLLATE NOCASE REFERENCES projects(id) ON UPDATE CASCADE,
      id         TEXT NOT NULL,
      name       TEXT NOT NULL DEFAULT '',
      folder     TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT '',
      commands   TEXT NOT NULL DEFAULT '{}',
      rules_file TEXT NOT NULL DEFAULT 'CLAUDE.md',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project, id)
    );
    CREATE UNIQUE INDEX project_repos_folder ON project_repos (project, folder COLLATE NOCASE);

    CREATE TABLE project_contracts (
      project    TEXT NOT NULL COLLATE NOCASE REFERENCES projects(id) ON UPDATE CASCADE,
      name       TEXT NOT NULL COLLATE NOCASE,
      owner      TEXT NOT NULL,
      source     TEXT NOT NULL DEFAULT '',
      consumers  TEXT NOT NULL DEFAULT '[]',
      rule       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project, name)
    );

    CREATE TABLE task_touches (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      repo    TEXT NOT NULL,
      PRIMARY KEY (task_id, repo)
    );
    CREATE INDEX task_touches_repo ON task_touches (repo);
  `);
}

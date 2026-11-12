import type { Database as DB } from 'better-sqlite3';

export const name = '20261112130000_add-project-description';

// What a project covers, so agents listing projects can tell them apart.
// Kept out of the session instructions (4096-char budget); getProjects returns it.
export function up(db: DB): void {
  db.exec(`ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT '';`);
}

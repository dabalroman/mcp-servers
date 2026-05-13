import type { Database as DB } from 'better-sqlite3';

export const name = '20260513000000_normalize-literal-newlines';

export function up(db: DB): void {
  db.exec(`
    UPDATE tasks SET description = replace(description, '\\n', char(10))
    WHERE description LIKE '%\\n%';
    UPDATE tasks SET title = replace(title, '\\n', char(10))
    WHERE title LIKE '%\\n%';
  `);
}

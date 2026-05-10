#!/usr/bin/env node
// Standalone one-shot migrator: legacy markdown TASKS.md / TASKS_DONE.md → tasks.db.
//
// Usage:
//   node migrate.js <legacy-tasks.md> <legacy-tasks_done.md> <output.db>
//
// Behaviour:
//   - Refuses to run if <output.db> already exists (rename or remove first).
//   - Backs up legacy files as <input>.bak (overwrites prior .bak) before any read.
//   - Bundles its own legacy markdown parser; main `tasks.js` does NOT depend on it.

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStore } from './tasks.js';

const RELATIONS_SET = new Set([
  'blocks', 'is blocked by',
  'depends on', 'is depended on by',
  'causes', 'is caused by',
  'tests', 'is tested by',
  'relates to',
]);

export function parseLegacyMarkdown(content) {
  const lines = content.split('\n');
  let counter = 0;

  const counterLine = lines.find((l) => /^# Counter:\s*\d+/.test(l));
  if (counterLine) {
    const m = counterLine.match(/^# Counter:\s*(\d+)/);
    if (m) counter = parseInt(m[1], 10);
  }

  const tasks = [];
  let i = 0;

  while (i < lines.length) {
    const headerMatch = lines[i].match(/^# (\d+) (.+)$/);
    if (!headerMatch) { i++; continue; }

    const id = parseInt(headerMatch[1], 10);
    const title = headerMatch[2].trim();

    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j >= lines.length) { i++; continue; }

    const metaLine = lines[j].trim();
    const metaMatch = metaLine.match(
      /^##\s*(bug|feature|idea|tool|other)\s*\|\s*(todo|in_progress|done|refinement)\s*\|\s*(low|medium|high|critical)$/
    );
    if (!metaMatch) { i = j + 1; continue; }
    const [, type, status, priority] = metaMatch;

    const bodyLines = [];
    let k = j + 1;
    while (k < lines.length && !lines[k].match(/^# /)) {
      bodyLines.push(lines[k]);
      k++;
    }
    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop();

    let scope;
    let firstNonBlank = 0;
    while (firstNonBlank < bodyLines.length && bodyLines[firstNonBlank].trim() === '') firstNonBlank++;

    const scopeMatch = bodyLines[firstNonBlank]?.match(/^\$scope:\s*(.+)$/);
    if (scopeMatch) {
      scope = scopeMatch[1].trim();
      bodyLines.splice(firstNonBlank, 1);
      while (bodyLines.length > 0 && bodyLines[firstNonBlank]?.trim() === '') bodyLines.splice(firstNonBlank, 1);
    }

    let refs;
    const refMatch = bodyLines[firstNonBlank]?.match(/^\$ref:\s*(.+)$/);
    if (refMatch) {
      refs = refMatch[1].split(' | ').flatMap((part) => {
        const m = part.match(/^#(\d+)(?:\s+(.+))?$/);
        if (!m) return [];
        const refId = parseInt(m[1], 10);
        const text = m[2]?.trim();
        if (!text) return [{ id: refId, relation: 'relates to' }];
        if (RELATIONS_SET.has(text)) return [{ id: refId, relation: text }];
        return [{ id: refId, relation: text, nonCanonical: true }];
      });
      bodyLines.splice(firstNonBlank, 1);
      while (bodyLines.length > 0 && bodyLines[firstNonBlank]?.trim() === '') bodyLines.splice(firstNonBlank, 1);
    }

    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop();

    tasks.push({ id, title, type, status, priority, scope, refs, description: bodyLines.join('\n') });
    i = k;
  }

  return { counter, tasks };
}

export function migrateToSqlite({ legacyTasks, legacyDone, outputDb }) {
  if (existsSync(outputDb)) {
    throw new Error(
      `Output database "${outputDb}" already exists. Refusing to overwrite. ` +
      `Rename or remove it before running migrate.`
    );
  }

  // Back up legacy files (overwrites any prior .bak).
  if (existsSync(legacyTasks)) copyFileSync(legacyTasks, legacyTasks + '.bak');
  if (existsSync(legacyDone))  copyFileSync(legacyDone,  legacyDone  + '.bak');

  const activeContent = existsSync(legacyTasks) ? readFileSync(legacyTasks, 'utf8') : '';
  const doneContent   = existsSync(legacyDone)  ? readFileSync(legacyDone,  'utf8') : '';

  const { counter, tasks: active } = parseLegacyMarkdown(activeContent);
  const { tasks: doneRaw } = parseLegacyMarkdown(doneContent);

  // De-dupe: active wins (transient state during a partially-failed move).
  const activeIds = new Set(active.map((t) => t.id));
  const done = doneRaw.filter((t) => !activeIds.has(t.id));
  const all = [...active, ...done];

  const store = createStore(outputDb);
  const db = store.db;

  db.prepare("UPDATE meta SET value = ? WHERE key = 'counter'").run(String(counter));

  // Insert tasks first, then refs (FK constraints).
  const insertTask = db.prepare(
    'INSERT INTO tasks (id, title, type, status, priority, scope, summary, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertRef = db.prepare(
    'INSERT OR IGNORE INTO refs (from_id, to_id, relation, non_canonical) VALUES (?, ?, ?, ?)'
  );

  db.transaction(() => {
    for (const t of all) {
      insertTask.run(
        t.id,
        t.title,
        t.type,
        t.status,
        t.priority,
        t.scope ?? null,
        null, // summary — no equivalent in legacy format
        t.description ?? ''
      );
    }
    const validIds = new Set(all.map((t) => t.id));
    for (const t of all) {
      if (!t.refs?.length) continue;
      for (const ref of t.refs) {
        if (ref.id === t.id) continue;
        if (!validIds.has(ref.id)) continue;
        insertRef.run(t.id, ref.id, ref.relation, ref.nonCanonical ? 1 : 0);
      }
    }
  })();

  store.close();

  return { counter, activeCount: active.length, doneCount: done.length };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const [legacyTasks, legacyDone, outputDb] = process.argv.slice(2).map((p) => p && resolve(p));
  if (!legacyTasks || !legacyDone || !outputDb) {
    console.error('Usage: node migrate.js <legacy-tasks.md> <legacy-tasks_done.md> <output.db>');
    process.exit(1);
  }
  try {
    const result = migrateToSqlite({ legacyTasks, legacyDone, outputDb });
    console.log(
      `Migration complete: ${result.activeCount} active + ${result.doneCount} done tasks → ${outputDb} ` +
      `(counter = ${result.counter}). Backups written next to legacy files.`
    );
  } catch (err) {
    console.error(`Migration failed: ${err.message}`);
    process.exit(1);
  }
}

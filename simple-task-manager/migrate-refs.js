#!/usr/bin/env node
// One-shot migration: normalize legacy ref notes to canonical relations
// and backfill missing inverse refs.
//
// Usage:
//   node migrate-refs.js
//   node migrate-refs.js /path/to/TASKS.md /path/to/TASKS_DONE.md
//
// Defaults to TASKS_FILE / TASKS_DONE_FILE env vars, then TASKS.md / TASKS_DONE.md
// in the current directory.

import { resolve } from 'path';
import { parseTasks, writeTasks, writeDoneTasks, applyRefs, RELATIONS } from './tasks.js';

const [,, arg1, arg2] = process.argv;
const tasksFile = resolve(arg1 ?? process.env.TASKS_FILE ?? 'TASKS.md');
const doneFile  = resolve(arg2 ?? process.env.TASKS_DONE_FILE ?? 'TASKS_DONE.md');

const RELATIONS_SET = new Set(RELATIONS);
const LEGACY_MAP = {
  'see also': 'relates to',
  'replaces':  'relates to',
  'related to': 'relates to',
  'related':   'relates to',
};

const { counter, tasks: active } = parseTasks(tasksFile);
const { tasks: done } = parseTasks(doneFile);
const all = [...active, ...done];

let normalized = 0;
let mirrored = 0;

// Pass 1: normalize non-canonical legacy notes
for (const task of all) {
  if (!task.refs) continue;
  for (const ref of task.refs) {
    if (!ref.nonCanonical) continue;
    const mapped = LEGACY_MAP[ref.relation.toLowerCase()];
    if (mapped) {
      console.log(`  #${task.id}: "${ref.relation}" → "${mapped}" (ref to #${ref.id})`);
      ref.relation = mapped;
      delete ref.nonCanonical;
      normalized++;
    } else {
      console.log(`  #${task.id}: keeping custom note "${ref.relation}" (ref to #${ref.id}) — not in migration map`);
    }
  }
}

// Pass 2: backfill missing inverses for every canonical ref
for (const task of all) {
  if (!task.refs) continue;
  const canonRefs = task.refs.filter(r => !r.nonCanonical);
  if (!canonRefs.length) continue;

  const countBefore = all.reduce((n, t) => n + (t.refs?.length ?? 0), 0);
  applyRefs(all, task.id, [], task.refs);
  const countAfter = all.reduce((n, t) => n + (t.refs?.length ?? 0), 0);
  mirrored += countAfter - countBefore;
}

// Write back
writeTasks(tasksFile, counter, active);
writeDoneTasks(doneFile, done);

console.log(`\nMigration complete.`);
console.log(`  Normalized:      ${normalized} legacy note(s)`);
console.log(`  Inverses added:  ${mirrored} ref(s)`);
console.log(`  Active tasks:    ${active.length}`);
console.log(`  Done tasks:      ${done.length}`);

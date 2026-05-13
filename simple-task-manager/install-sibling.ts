#!/usr/bin/env node
// Installs the `task-manager-ui/` sub-package during this package's
// `prepare` script. Skipped silently if the directory is missing
// (someone trimmed it to keep their install slim).
//
// This makes a fresh clone + `npm install` in simple-task-manager pull
// the UI along — see README "Quick Start". To opt out, delete or rename
// the task-manager-ui directory before running `npm install`.
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const sibling = resolve(here, 'task-manager-ui');

if (!existsSync(resolve(sibling, 'package.json'))) {
  console.log('[simple-task-manager] task-manager-ui sibling not found — skipping its install');
  process.exit(0);
}

console.log('[simple-task-manager] installing task-manager-ui sibling…');
const r = spawnSync('npm', ['install'], { cwd: sibling, stdio: 'inherit' });
if (r.status && r.status !== 0) {
  console.error('[simple-task-manager] task-manager-ui install failed (exit ' + r.status + ') — continuing without the UI');
}
process.exit(0);

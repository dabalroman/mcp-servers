#!/usr/bin/env node
import { execSync } from 'child_process';
import { writeFileSync, chmodSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// task-manager-ui sub-package — optional; the hook builds it only when present.
const siblingUi = resolve(__dirname, 'task-manager-ui');

let gitDir: string;
try {
  gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
} catch {
  process.exit(0); // not a git repo, skip
}

const hooksDir = join(gitDir, 'hooks');
mkdirSync(hooksDir, { recursive: true });

const lines = [
  '#!/bin/sh',
  'set -e',
  `cd "${__dirname}" && npx tsx bump-version.ts && npm test && npm run build`,
];
if (existsSync(siblingUi)) {
  lines.push(`cd "${siblingUi}" && npm test && npm run build`);
  // The UI bundle is checked into git; stage the freshly-rebuilt assets so
  // the commit always reflects current source. The repo root is the
  // mcp-servers checkout, not this package.
  const repoRoot = resolve(__dirname, '..');
  lines.push(`git -C "${repoRoot}" add "${siblingUi.replace(repoRoot + '/', '')}"/dist`);
}
lines.push('');

const hook = join(hooksDir, 'pre-commit');
writeFileSync(hook, lines.join('\n'));
chmodSync(hook, 0o755);
console.log('pre-commit hook installed');

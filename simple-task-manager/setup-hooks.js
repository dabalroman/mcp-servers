#!/usr/bin/env node
import { execSync } from 'child_process';
import { writeFileSync, chmodSync, mkdirSync } from 'fs';
import { join } from 'path';

let gitDir;
try {
  gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
} catch {
  process.exit(0); // not a git repo, skip
}

const hooksDir = join(gitDir, 'hooks');
mkdirSync(hooksDir, { recursive: true });

const hook = join(hooksDir, 'pre-commit');
writeFileSync(hook, '#!/bin/sh\ncd simple-task-manager && node bump-version.js && npm test\n');
chmodSync(hook, 0o755);
console.log('pre-commit hook installed');

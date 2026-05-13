#!/usr/bin/env node
import { execSync } from 'child_process';
import { writeFileSync, chmodSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let gitDir: string;
try {
  gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
} catch {
  process.exit(0); // not a git repo, skip
}

const hooksDir = join(gitDir, 'hooks');
mkdirSync(hooksDir, { recursive: true });

const hook = join(hooksDir, 'pre-commit');
writeFileSync(
  hook,
  `#!/bin/sh\ncd ${__dirname} && npx tsx bump-version.ts && npm test && npm run build\n`
);
chmodSync(hook, 0o755);
console.log('pre-commit hook installed');

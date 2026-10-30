#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const pkgDir = dirname(fileURLToPath(import.meta.url));
const versionFile = join(pkgDir, 'version.ts');
const pluginFile = join(pkgDir, 'plugin', '.claude-plugin', 'plugin.json');

let seq: string;
const now = new Date();
const curYear = String(now.getFullYear());
const curMonth = String(now.getMonth() + 1).padStart(2, '0');

try {
  const content = readFileSync(versionFile, 'utf8');
  const m = content.match(/VERSION = '(\d{4})-(\d{2})-(\d{3})'/);
  if (m && m[1] === curYear && m[2] === curMonth && m[3]) {
    seq = String(parseInt(m[3], 10) + 1).padStart(3, '0');
  } else {
    seq = '001';
  }
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  seq = '001'; // first run — version.ts doesn't exist yet
}

const version = `${curYear}-${curMonth}-${seq}`;
writeFileSync(versionFile, `export const VERSION = '${version}';\n`);
// A git-installed plugin only updates when this changes, so it moves with every commit.
const { name, version: _old, ...rest } = JSON.parse(readFileSync(pluginFile, 'utf8')) as Record<string, unknown>;
writeFileSync(pluginFile, `${JSON.stringify({ name, version, ...rest }, null, 2)}\n`);
execSync(`git add "${versionFile}" "${pluginFile}"`);
console.log(`version → ${version}`);

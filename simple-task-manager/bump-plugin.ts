#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, relative, resolve } from 'path';

const pluginDir = resolve(process.argv[2] ?? '');
const repoRoot = execSync('git rev-parse --show-toplevel', { cwd: pluginDir, encoding: 'utf8' }).trim();
const rel = relative(repoRoot, pluginDir);
const pluginFile = join(pluginDir, '.claude-plugin', 'plugin.json');

const staged = execSync(`git -C "${repoRoot}" diff --cached --name-only -- "${rel}"`, { encoding: 'utf8' }).trim();
if (staged === '') process.exit(0);

const manifest = JSON.parse(readFileSync(pluginFile, 'utf8')) as { version?: string } & Record<string, unknown>;
const [major = 0, minor = 0, patch = 0] = (manifest.version ?? '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
manifest.version = `${major}.${minor}.${patch + 1}`;
writeFileSync(pluginFile, `${JSON.stringify(manifest, null, 2)}\n`);
execSync(`git -C "${repoRoot}" add "${pluginFile}"`);
console.log(`${rel} version → ${manifest.version}`);

#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';

const pluginDir = resolve(process.argv[2] ?? '');
const pluginFile = join(pluginDir, '.claude-plugin', 'plugin.json');

const manifest = JSON.parse(readFileSync(pluginFile, 'utf8')) as { version?: string } & Record<string, unknown>;
const [major = 0, minor = 0, patch = 0] = (manifest.version ?? '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
manifest.version = `${major}.${minor}.${patch + 1}`;
writeFileSync(pluginFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${basename(pluginDir)} version → ${manifest.version}`);

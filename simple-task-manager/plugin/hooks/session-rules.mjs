// SessionStart hook: prints RULES.md into context, but only in repos that bind
// the task-manager MCP: through the repo's .mcp.json, or through ~/.claude.json
// (user scope at the top level, local scope under projects[<dir>]). Plain ESM
// with no deps because it runs straight from the plugin cache, unbuilt. Always
// exits 0 so a broken or missing config never blocks a session.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const { CLAUDE_PROJECT_DIR, CLAUDE_PLUGIN_ROOT } = process.env;

// Strip a BOM: Windows editors write one and JSON.parse rejects it.
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

const bindsTaskManager = (cfg) => !!cfg?.mcpServers?.['task-manager'];

function isBound() {
  if (!CLAUDE_PROJECT_DIR) return false;
  if (bindsTaskManager(readJson(join(CLAUDE_PROJECT_DIR, '.mcp.json')))) return true;
  const claudeJson = readJson(join(homedir(), '.claude.json'));
  return bindsTaskManager(claudeJson) || bindsTaskManager(claudeJson?.projects?.[CLAUDE_PROJECT_DIR]);
}

try {
  if (isBound()) process.stdout.write(readFileSync(join(CLAUDE_PLUGIN_ROOT, 'RULES.md'), 'utf8'));
} catch {
  // Env unset or unreadable RULES.md: inject nothing.
}

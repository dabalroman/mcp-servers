// SessionStart hook: prints RULES.md into context, but only in repos whose
// .mcp.json binds the task-manager MCP. Plain ESM with no deps because it runs
// straight from the plugin cache, unbuilt. Always exits 0 so a broken or
// missing .mcp.json never blocks a session.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { CLAUDE_PROJECT_DIR, CLAUDE_PLUGIN_ROOT } = process.env;

try {
  // Strip a BOM: Windows editors write one and JSON.parse rejects it.
  const config = JSON.parse(readFileSync(join(CLAUDE_PROJECT_DIR, '.mcp.json'), 'utf8').replace(/^﻿/, ''));
  if (config?.mcpServers?.['task-manager']) {
    process.stdout.write(readFileSync(join(CLAUDE_PLUGIN_ROOT, 'RULES.md'), 'utf8'));
  }
} catch {
  // Env unset, no .mcp.json, invalid JSON or unreadable RULES.md: inject nothing.
}

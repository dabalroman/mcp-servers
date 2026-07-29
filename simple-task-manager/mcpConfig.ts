/**
 * Helpers for reading and writing project `.mcp.json` files.
 *
 * Claude Code's project-level MCP loader is strict JSON — comments break it.
 * `serializeMcpConfig` writes pure JSON; install.ts surfaces env-var docs via
 * the install console + README instead of inline comments. `ENV_DOCS` and
 * `ENV_ORDER` are exported so install.ts can print and order consistently.
 */

export type McpEntry = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export type McpConfig = {
  mcpServers: Record<string, McpEntry>;
};

/** Per-env-var documentation. Printed by install.ts after writing `.mcp.json`. */
export const ENV_DOCS: Record<string, string[]> = {
  TASKS_DB: [
    'Absolute path to the SQLite database that holds this project\'s tasks.',
  ],
  PROJECT_NAME: [
    'Human-readable label for the project. Shown in the UI header (big pill)',
    'and the browser tab title. Also used as the pm2 process name in',
    'standalone mode, so it must be unique across your pm2 process list.',
  ],
  TASK_UI_PORT: [
    'HTTP port the UI binds to. Default 7374.',
  ],
  TASK_UI_MODE: [
    'How the task-manager UI runs. Allowed values:',
    '  "bundled"    — MCP spawns the UI as a child process (default).',
    '                 UI dies with the Claude session.',
    '  "standalone" — UI runs as a long-lived pm2 process, set up via',
    '                 `npx tsx ~/.claude/mcp-servers/simple-task-manager/setup-standalone.ts on`.',
    '                 Survives MCP restarts and Claude session closes.',
    '  "disabled"   — MCP does not start the UI at all (headless / tests).',
  ],
  TASK_UI_AUTO_OPEN_IN_BROWSER: [
    'Set to "1" to open the UI in the system browser when it starts.',
    'Default "0" (no auto-open).',
  ],
};

/** Canonical order for emitted env keys — keeps `.mcp.json` files diff-stable. */
export const ENV_ORDER = [
  'TASKS_DB',
  'PROJECT_NAME',
  'TASK_UI_PORT',
  'TASK_UI_MODE',
  'TASK_UI_AUTO_OPEN_IN_BROWSER',
];

/**
 * Renamed env keys the MCP no longer consumes. The health command flags any of
 * these found in `.mcp.json` as ✗ with the rename hint. Update this in lockstep
 * when renaming a canonical env var.
 */
export const LEGACY_ENV_KEYS: Record<string, string> = {
  TASK_UI_DISABLE: 'renamed: set `TASK_UI_MODE=disabled` instead',
  AUTO_OPEN_TASK_UI: 'renamed to `TASK_UI_AUTO_OPEN_IN_BROWSER`',
};

/** Returns true when an existing task-manager entry points at the old pre-dist path. */
export function isStaleEntry(e: McpEntry | undefined): boolean {
  if (!e) return false;
  const arg0 = e.args?.[0] ?? '';
  return arg0.endsWith('/server.ts') || (arg0.endsWith('/server.js') && !arg0.endsWith('/dist/server.js'));
}

/** The file `install.ts --global` @-imports into `~/.claude/CLAUDE.md`. That import lands in every
 *  session of every project, so it points at the setup instructions only — the package's own dev
 *  docs (CLAUDE.md) load on demand when working in this repo and must not be broadcast globally. */
export const GLOBAL_IMPORT_FILE = 'SETUP.md';

/** An `@…/simple-task-manager/{CLAUDE,SETUP}.md` line previously written by --global. CLAUDE.md is
 *  matched too so installs predating GLOBAL_IMPORT_FILE migrate off the dev docs rather than
 *  stacking a second import next to the stale one. */
const GLOBAL_IMPORT_LINE = /^@.*[/\\]simple-task-manager[/\\](?:CLAUDE|SETUP)\.md$/;

export type GlobalImportAction = 'unchanged' | 'added' | 'migrated';

/** Idempotently point the global CLAUDE.md's import at `importPath`, rewriting a stale line in
 *  place. Pure — install.ts owns the file I/O, this owns the decision. */
export function updateGlobalImport(
  existing: string,
  importPath: string
): { content: string; action: GlobalImportAction } {
  const line = `@${importPath}`;
  const lines = existing.split('\n');
  const idx = lines.findIndex((l) => GLOBAL_IMPORT_LINE.test(l.trim()));

  if (idx === -1) {
    const separator = existing.length && !existing.endsWith('\n') ? '\n' : '';
    return { content: existing + separator + line + '\n', action: 'added' };
  }

  if (lines[idx]!.trim() === line) return { content: existing, action: 'unchanged' };

  lines[idx] = line;
  return { content: lines.join('\n'), action: 'migrated' };
}

export function parseMcpConfig(raw: string): McpConfig {
  return JSON.parse(raw) as McpConfig;
}

export function serializeMcpConfig(config: McpConfig): string {
  const I = '  ';
  const out: string[] = [];
  out.push('{');
  out.push(`${I}"mcpServers": {`);

  const serverKeys = Object.keys(config.mcpServers);
  serverKeys.forEach((serverKey, sIdx) => {
    const entry = config.mcpServers[serverKey]!;
    const sLast = sIdx === serverKeys.length - 1;
    out.push(`${I}${I}${JSON.stringify(serverKey)}: {`);
    out.push(`${I}${I}${I}"command": ${JSON.stringify(entry.command)},`);
    out.push(`${I}${I}${I}"args": ${JSON.stringify(entry.args)}${entry.env ? ',' : ''}`);

    if (entry.env) {
      out.push(`${I}${I}${I}"env": {`);
      const envKeys = orderEnv(entry.env);
      envKeys.forEach((envKey, eIdx) => {
        const eLast = eIdx === envKeys.length - 1;
        const value = entry.env![envKey]!;
        out.push(`${I}${I}${I}${I}${JSON.stringify(envKey)}: ${JSON.stringify(value)}${eLast ? '' : ','}`);
      });
      out.push(`${I}${I}${I}}`);
    }

    out.push(`${I}${I}}${sLast ? '' : ','}`);
  });

  out.push(`${I}}`);
  out.push('}');
  return out.join('\n') + '\n';
}

function orderEnv(env: Record<string, string>): string[] {
  const known = ENV_ORDER.filter((k) => k in env);
  const rest = Object.keys(env).filter((k) => !ENV_ORDER.includes(k));
  return [...known, ...rest];
}

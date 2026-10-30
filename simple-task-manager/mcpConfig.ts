/**
 * Helpers for reading and writing project `.mcp.json` files.
 *
 * Claude Code's project-level MCP loader is strict JSON — comments break it.
 * `serializeMcpConfig` writes pure JSON; install.ts surfaces env-var docs via
 * the install console + README instead of inline comments. `ENV_DOCS` and
 * `ENV_ORDER` are exported so install.ts can print and order consistently.
 */
/**
 * The server's pm2 app. One server serves every project on its DB, so the name
 * follows the port (one UI per port), not the repo: `task-manager` on the default
 * port, `task-manager-<port>` otherwise.
 */
export function pm2AppName(port: string | undefined): string {
  return !port || port === '7374' ? 'task-manager' : `task-manager-${port}`;
}

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
    'The project this repo\'s MCP sessions are bound to: list tools and add',
    'default to it. Unset means "default". A DB that only holds the "default"',
    'project adopts this name on the first MCP start.',
  ],
  TASK_UI_PORT: [
    'HTTP port the UI binds to. Default 7374.',
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
  'TASK_UI_AUTO_OPEN_IN_BROWSER',
];

/**
 * Renamed env keys the MCP no longer consumes. The health command flags any of
 * these found in `.mcp.json` as ✗ with the rename hint. Update this in lockstep
 * when renaming a canonical env var.
 */
export const LEGACY_ENV_KEYS: Record<string, string> = {
  TASK_UI_MODE: 'removed: a stdio entry is always bundled. To share one DB, run the server (`install.ts --server on`) and connect repos in client mode (UI → Connect a machine)',
  TASK_UI_DISABLE: 'removed: a stdio entry always runs its UI. For no per-repo UI, connect the repo in client mode (UI → Connect a machine)',
  AUTO_OPEN_TASK_UI: 'renamed to `TASK_UI_AUTO_OPEN_IN_BROWSER`',
};

/** Returns true when an existing task-manager entry points at the old pre-dist path. */
export function isStaleEntry(e: McpEntry | undefined): boolean {
  if (!e) return false;
  const arg0 = e.args?.[0] ?? '';
  return arg0.endsWith('/server.ts') || (arg0.endsWith('/server.js') && !arg0.endsWith('/dist/server.js'));
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

export const INSTALL_USAGE = [
  'Usage: npx tsx install.ts [project-dir]                       bundled: write the stdio entry into <project-dir>/.mcp.json',
  '       npx tsx install.ts --server on|off [dir] [--db <path>] [--port <n>]',
  '                                                              server: run the UI + /mcp as a pm2 app (ecosystem file in <dir>)',
  '  (dir defaults to the current directory, --db to <dir>/tasks.db, --port to 7374)',
].join('\n');

const PLUGIN_INSTALL = 'claude plugin marketplace add dabalroman/mcp-servers && claude plugin install tm@dabalroman --scope user';

export type InstallArgs =
  | { server?: undefined; projectDir?: string }
  | { server: 'on' | 'off'; projectDir?: string; db?: string; port?: string };

// Parsed before the build so a typo fails fast. --global was the pre-plugin
// way to install the skills; without this check it would be taken as a dir.
export function parseInstallArgs(argv: string[]): InstallArgs | { error: string } {
  if (argv.includes('--global')) {
    return { error: `--global is gone: skills and rules ship as a Claude Code plugin now. Run: ${PLUGIN_INSTALL}` };
  }
  let server: 'on' | 'off' | undefined;
  let db: string | undefined;
  let port: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--server' || a === '--db' || a === '--port') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('-')) return { error: `${a} needs a value` };
      if (a === '--server') {
        if (value !== 'on' && value !== 'off') return { error: `--server takes on or off, got: ${value}` };
        server = value;
      } else if (a === '--db') {
        db = value;
      } else {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 65535) return { error: `--port must be an integer 1-65535, got: ${value}` };
        port = value;
      }
    } else if (a.startsWith('-')) {
      return { error: `Unknown option ${a}` };
    } else {
      positional.push(a);
    }
  }
  if (positional.length > 1) return { error: `Expected at most one dir, got: ${positional.join(' ')}` };
  const projectDir = positional[0];
  if (!server) {
    if (db !== undefined || port !== undefined) return { error: '--db and --port only apply with --server on' };
    return projectDir === undefined ? {} : { projectDir };
  }
  if (server === 'off' && db !== undefined) return { error: '--db only applies with --server on' };
  return { server, ...(projectDir !== undefined && { projectDir }), ...(db !== undefined && { db }), ...(port !== undefined && { port }) };
}

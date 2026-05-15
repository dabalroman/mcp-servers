/**
 * Helpers for reading and writing project `.mcp.json` files in JSONC form.
 *
 * Claude Code's MCP loader accepts `//` and `/* … *\/` comments in `.mcp.json`
 * (same parser as `settings.json`). install.ts emits a documented config when
 * registering the task-manager entry; setup-standalone.ts reads that file,
 * mutates one or two env values, and writes it back through the same emitter
 * so the comments survive the round-trip.
 *
 * Keep this file self-contained — both install.ts and setup-standalone.ts
 * import it; nothing else should.
 */

export type McpEntry = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export type McpConfig = {
  mcpServers: Record<string, McpEntry>;
};

/** Per-env-var documentation emitted as JSONC comments above each value. */
const ENV_DOCS: Record<string, string[]> = {
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
const ENV_ORDER = [
  'TASKS_DB',
  'PROJECT_NAME',
  'TASK_UI_PORT',
  'TASK_UI_MODE',
  'TASK_UI_AUTO_OPEN_IN_BROWSER',
];

/** Strip `//` line comments and `/* … *\/` block comments outside strings. */
export function stripJsonComments(input: string): string {
  let out = '';
  const n = input.length;
  let i = 0;
  while (i < n) {
    const c = input[i];
    const c2 = input[i + 1];
    if (c === '"') {
      const start = i;
      i++;
      while (i < n) {
        if (input[i] === '\\' && i + 1 < n) { i += 2; continue; }
        if (input[i] === '"') { i++; break; }
        i++;
      }
      out += input.slice(start, i);
      continue;
    }
    if (c === '/' && c2 === '/') {
      while (i < n && input[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n - 1 && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function parseMcpConfig(raw: string): McpConfig {
  return JSON.parse(stripJsonComments(raw)) as McpConfig;
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
        const docs = serverKey === 'task-manager' ? ENV_DOCS[envKey] : undefined;
        if (docs) {
          if (eIdx > 0) out.push('');
          docs.forEach((line) => out.push(`${I}${I}${I}${I}// ${line}`));
        }
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

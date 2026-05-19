import { readdirSync, existsSync, accessSync, constants as fsConstants, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as http from 'node:http';
import { networkInterfaces } from 'node:os';
import Database from 'better-sqlite3';
import { text, toListTask, notFoundError, type MCPContent } from './shared.js';
import { ALL_TYPES } from '../tasks.js';
import { ENV_ORDER, LEGACY_ENV_KEYS } from '../mcpConfig.js';
import type { Store, Task, TaskType, StatusFilter } from '../tasks.js';

export async function handleGetByType(store: Store, { type, status }: { type: TaskType; status?: StatusFilter }): Promise<MCPContent> {
  return text({ tasks: store.getByType(type, status).map(toListTask) });
}

export async function handleGetOverview(store: Store, { status }: { status?: StatusFilter } = {}): Promise<MCPContent> {
  return text({ overview: store.getOverview(status) });
}

export async function handleGetNext(store: Store, { type }: { type?: TaskType } = {}): Promise<MCPContent> {
  const task = store.getNext(type);
  return text({ task: task ? toListTask(task) : null });
}

export async function handleGetAll(store: Store, { status }: { status?: StatusFilter } = {}): Promise<MCPContent> {
  const grouped: Partial<Record<TaskType, (Task | Omit<Task, 'description'>)[]>> = {};
  for (const type of ALL_TYPES) {
    const ofType = store.getByType(type, status).map(toListTask);
    if (ofType.length > 0) grouped[type] = ofType;
  }
  return text({ tasks: grouped });
}

export async function handleGetById(store: Store, { id }: { id: number }): Promise<MCPContent> {
  const task = store.getById(id);
  if (!task) return notFoundError(id, store);
  return text({ task });
}

export async function handleGetByScope(store: Store, { scope, status }: { scope: string; status?: StatusFilter }): Promise<MCPContent> {
  return text({ scope, tasks: store.getByScope(scope, status).map(toListTask) });
}

export async function handleGetRelated(store: Store, { id, status }: { id: number; status?: StatusFilter }): Promise<MCPContent> {
  const result = store.getRelated(id, status);
  if (!result) return notFoundError(id, store);
  return text({
    task: result.task,
    outbound: result.outbound.map((t) => ({ ...toListTask(t), refRelation: t.refRelation })),
    inbound:  result.inbound.map((t)  => ({ ...toListTask(t), refRelation: t.refRelation })),
  });
}

export async function handleGetScopes(store: Store): Promise<MCPContent> {
  return text({ scopes: store.getScopes() });
}

// ── health ─────────────────────────────────────────────────────────────────────

type CheckResult = { symbol: '✓' | '⚠' | '✗'; line: string };

function check(symbol: CheckResult['symbol'], line: string): CheckResult {
  return { symbol, line };
}

function validateCanonicalEnv(key: string, raw: string): CheckResult {
  switch (key) {
    case 'TASKS_DB':
      return validateTasksDb(raw);
    case 'PROJECT_NAME':
      return raw
        ? check('✓', `PROJECT_NAME = ${raw}`)
        : check('✗', 'PROJECT_NAME missing or empty — UI header + tab title will be empty');
    case 'TASK_UI_PORT': {
      const n = Number(raw);
      if (raw && Number.isInteger(n) && n >= 1 && n <= 65535) {
        return check('✓', `TASK_UI_PORT = ${raw}`);
      }
      return check('✗', raw
        ? `TASK_UI_PORT = ${raw} (must be an integer in [1, 65535])`
        : 'TASK_UI_PORT missing (must be an integer in [1, 65535])');
    }
    case 'TASK_UI_MODE': {
      if (!raw) return check('⚠', 'TASK_UI_MODE not set — defaults to "bundled"');
      if (raw === 'bundled' || raw === 'standalone' || raw === 'disabled') {
        return check('✓', `TASK_UI_MODE = ${raw}`);
      }
      return check('✗', `TASK_UI_MODE = ${raw} (must be one of: bundled, standalone, disabled)`);
    }
    case 'TASK_UI_AUTO_OPEN_IN_BROWSER':
      if (raw === '0' || raw === '1') {
        return check('✓', `TASK_UI_AUTO_OPEN_IN_BROWSER = ${raw}`);
      }
      return check('✗', raw
        ? `TASK_UI_AUTO_OPEN_IN_BROWSER = ${raw} (must be "0" or "1")`
        : 'TASK_UI_AUTO_OPEN_IN_BROWSER missing (must be "0" or "1")');
    default:
      return raw
        ? check('✓', `${key} = ${raw}`)
        : check('⚠', `${key} not set`);
  }
}

function validateTasksDb(raw: string): CheckResult {
  if (!raw) {
    return check('✗', 'TASKS_DB not set in .mcp.json — add it to mcpServers.task-manager.env');
  }
  if (existsSync(raw)) {
    return check('✓', `TASKS_DB = ${raw} (exists, writable)`);
  }
  const parentDir = dirname(raw);
  let parentWritable = false;
  try {
    accessSync(parentDir, fsConstants.W_OK);
    parentWritable = true;
  } catch { /* not writable */ }
  return parentWritable
    ? check('✓', `TASKS_DB = ${raw} (does not exist yet, parent directory writable)`)
    : check('✗', `TASKS_DB = ${raw} — file does not exist and parent directory is not writable`);
}

function renderSection(title: string, results: CheckResult[]): string {
  const lines = [`${title}`];
  for (const r of results) {
    lines.push(`  ${r.symbol} ${r.line}`);
  }
  return lines.join('\n');
}

function findMcpJson(startDir: string): string | null {
  let current = startDir;
  while (true) {
    const candidate = join(current, '.mcp.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function getLanIp(): string {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

function probeHttp(url: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

export async function handleHealth(): Promise<MCPContent> {
  const sections: string[] = [];

  // ── Config section ───────────────────────────────────────────────────────────
  const configChecks: CheckResult[] = [];

  const mcpJsonPath = findMcpJson(process.cwd());
  if (!mcpJsonPath) {
    configChecks.push(check('✗', '.mcp.json not found — run: npx tsx ~/.claude/mcp-servers/simple-task-manager/install.ts'));
    sections.push(renderSection('Config (.mcp.json)', configChecks));

    // Runtime section — skip most checks without config
    const runtimeChecks: CheckResult[] = [
      check('✗', 'Skipped — no .mcp.json found'),
    ];
    sections.push(renderSection('Runtime', runtimeChecks));

    const skillsChecks = await checkSkills();
    sections.push(renderSection('Skills', skillsChecks));

    return buildOutput(sections);
  }

  // Parse .mcp.json
  let mcpConfig: Record<string, unknown> = {};
  try {
    const raw = readFileSync(mcpJsonPath, 'utf-8');
    mcpConfig = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    configChecks.push(check('✗', `.mcp.json found at ${mcpJsonPath} but failed to parse — check JSON syntax`));
    sections.push(renderSection('Config (.mcp.json)', configChecks));
    return buildOutput(sections);
  }

  // Extract task-manager env block
  const servers = mcpConfig['mcpServers'];
  const taskManagerEntry = (servers && typeof servers === 'object' && !Array.isArray(servers))
    ? (servers as Record<string, unknown>)['task-manager']
    : undefined;
  const envBlock = (taskManagerEntry && typeof taskManagerEntry === 'object' && !Array.isArray(taskManagerEntry))
    ? (taskManagerEntry as Record<string, unknown>)['env']
    : undefined;
  const env = (envBlock && typeof envBlock === 'object' && !Array.isArray(envBlock))
    ? envBlock as Record<string, unknown>
    : {};

  // Validate each canonical env var by iterating ENV_ORDER — keeps health
  // honest when mcpConfig.ts adds/removes keys.
  for (const key of ENV_ORDER) {
    const raw = typeof env[key] === 'string' ? (env[key] as string) : '';
    configChecks.push(validateCanonicalEnv(key, raw));
  }

  // Flag legacy/unknown keys present in the env block.
  for (const key of Object.keys(env)) {
    if (ENV_ORDER.includes(key)) continue;
    const legacyHint = LEGACY_ENV_KEYS[key];
    if (legacyHint) {
      configChecks.push(check('✗', `${key} — ${legacyHint}`));
    } else {
      configChecks.push(check('⚠', `${key} — unknown, not consumed by MCP`));
    }
  }

  sections.push(renderSection('Config (.mcp.json)', configChecks));

  const uiModeRaw = typeof env['TASK_UI_MODE'] === 'string' ? env['TASK_UI_MODE'] : '';
  const projectName = typeof env['PROJECT_NAME'] === 'string' ? env['PROJECT_NAME'] : '';
  const uiPort = typeof env['TASK_UI_PORT'] === 'string' ? env['TASK_UI_PORT'] : '';
  const tasksDb = typeof env['TASKS_DB'] === 'string' ? env['TASKS_DB'] : '';

  const uiMode: 'standalone' | 'disabled' | 'bundled' =
    uiModeRaw === 'standalone' ? 'standalone'
    : uiModeRaw === 'disabled' ? 'disabled'
    : 'bundled';

  // ── Runtime section ──────────────────────────────────────────────────────────
  const runtimeChecks: CheckResult[] = [];
  const resolvedPort = uiPort || '7374';
  const probeUrl = `http://localhost:${resolvedPort}/`;
  const displayUrl = `http://${getLanIp()}:${resolvedPort}/`;

  const notReachableHint = uiMode === 'standalone'
    ? `is the standalone pm2 process running? Try \`pm2 status ${projectName || '<PROJECT_NAME>'}\``
    : uiMode === 'disabled'
    ? 'TASK_UI_MODE=disabled — set it to "bundled" and restart the MCP'
    : 'is the MCP running?';

  try {
    const statusCode = await probeHttp(probeUrl, 2000);
    if (statusCode >= 200 && statusCode < 300) {
      runtimeChecks.push(check('✓', `UI reachable at ${probeUrl} · ${displayUrl}`));
    } else {
      runtimeChecks.push(check('✗', `UI at ${probeUrl} returned HTTP ${statusCode} — ${notReachableHint}`));
    }
  } catch {
    runtimeChecks.push(check('✗', `UI not reachable at ${probeUrl} — ${notReachableHint}`));
  }

  // DB migration check
  const dbPath = tasksDb || (typeof process.env['TASKS_DB'] === 'string' ? process.env['TASKS_DB'] : '');
  if (!dbPath) {
    runtimeChecks.push(check('✗', 'DB migration check skipped — TASKS_DB not configured'));
  } else if (!existsSync(dbPath)) {
    runtimeChecks.push(check('⚠', `DB migration check skipped — ${dbPath} does not exist yet`));
  } else {
    try {
      const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
      let totalMigrations = 0;
      try {
        const files = readdirSync(migrationsDir);
        const jsCount = files.filter(f => f.endsWith('.js')).length;
        const tsCount = files.filter(f => f.endsWith('.ts')).length;
        totalMigrations = jsCount > 0 ? jsCount : tsCount;
      } catch { /* migrations dir not found */ }

      const db = new Database(dbPath, { readonly: true });
      // Short busy_timeout so health doesn't spuriously fail mid-migration or
      // during a large write — but stays bounded if something's actually stuck.
      db.pragma('busy_timeout = 2000');
      let appliedCount = 0;
      try {
        const row = db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM schema_migrations').get();
        appliedCount = row !== undefined ? row.count : 0;
      } finally {
        db.close();
      }

      if (totalMigrations === 0) {
        runtimeChecks.push(check('⚠', `DB schema check — could not determine migration file count (migrations dir missing or empty)`));
      } else if (appliedCount === totalMigrations) {
        runtimeChecks.push(check('✓', `DB schema up to date (${appliedCount}/${totalMigrations} migrations applied)`));
      } else {
        runtimeChecks.push(check('✗', `DB schema out of date — ${appliedCount}/${totalMigrations} migrations applied. Restart the MCP to apply pending migrations.`));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      runtimeChecks.push(check('✗', `DB migration check failed — ${msg}`));
    }
  }

  sections.push(renderSection('Runtime', runtimeChecks));

  // ── Skills section ───────────────────────────────────────────────────────────
  const skillsChecks = await checkSkills();
  sections.push(renderSection('Skills', skillsChecks));

  return buildOutput(sections, uiMode);
}

function checkSkills(): CheckResult[] {
  const homeDir = process.env['HOME'] ?? '';
  const skills = [
    { name: '/refine', path: join(homeDir, '.claude/commands/refine.md') },
    { name: '/implement', path: join(homeDir, '.claude/commands/implement.md') },
  ];
  return skills.map(skill => {
    if (existsSync(skill.path)) {
      return check('✓', `${skill.name} installed at ${skill.path}`);
    }
    return check('✗', `${skill.name} not found at ${skill.path} — Fix: Run: npx tsx ~/.claude/mcp-servers/simple-task-manager/install.ts`);
  });
}

function resolveUiModeFromProcess(): 'standalone' | 'disabled' | 'bundled' {
  const m = process.env['TASK_UI_MODE'];
  if (m === 'standalone') return 'standalone';
  if (m === 'disabled') return 'disabled';
  return 'bundled';
}

function buildOutput(sections: string[], ui?: 'standalone' | 'disabled' | 'bundled'): MCPContent {
  const divider = '─'.repeat(9);
  const body = sections.join('\n\n');
  const report = `health\n${divider}\n${body}`;
  return text({
    report,
    ui: ui ?? resolveUiModeFromProcess(),
    displayInstruction: 'Present this health report to the user as a markdown table with three columns: Status (✓/⚠/✗), Category (Config / Runtime / Skills), and Message. Each indented check line is one table row.',
  });
}

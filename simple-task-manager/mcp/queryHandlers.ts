import { readdirSync, existsSync, accessSync, constants as fsConstants, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as http from 'node:http';
import { networkInterfaces, homedir } from 'node:os';
import Database from 'better-sqlite3';
import { text, toListTask, notFoundError, resolveProject, type MCPContent, type SessionContext } from './shared.js';
import { ALL_TYPES, staleSchemaMessage } from '../tasks.js';
import { ENV_ORDER, LEGACY_ENV_KEYS, pm2AppName } from '../mcpConfig.js';
import { PACKAGE_DIR } from '../packageDir.js';
import { checkForUpdate } from '../updateCheck.js';
import type { Store, Task, TaskType, StatusFilter } from '../tasks.js';

export async function handleGetByType(store: Store, { type, status, project }: { type: TaskType; status?: StatusFilter; project?: string }, ctx: SessionContext): Promise<MCPContent> {
  const p = resolveProject(store, ctx, project);
  if (typeof p !== 'string') return p;
  return text({ tasks: store.getByType(p, type, status).map(toListTask) });
}

export async function handleGetOverview(store: Store, { status, project }: { status?: StatusFilter; project?: string }, ctx: SessionContext): Promise<MCPContent> {
  const p = resolveProject(store, ctx, project);
  if (typeof p !== 'string') return p;
  return text({ overview: store.getOverview(p, status) });
}

export async function handleGetNext(store: Store, { type, project }: { type?: TaskType; project?: string }, ctx: SessionContext): Promise<MCPContent> {
  const p = resolveProject(store, ctx, project);
  if (typeof p !== 'string') return p;
  const task = store.getNext(p, type);
  return text({ task: task ? toListTask(task) : null });
}

export async function handleGetAll(store: Store, { status, project }: { status?: StatusFilter; project?: string }, ctx: SessionContext): Promise<MCPContent> {
  const p = resolveProject(store, ctx, project);
  if (typeof p !== 'string') return p;
  const grouped: Partial<Record<TaskType, (Task | Omit<Task, 'description'>)[]>> = {};
  for (const type of ALL_TYPES) {
    const ofType = store.getByType(p, type, status).map(toListTask);
    if (ofType.length > 0) grouped[type] = ofType;
  }
  return text({ tasks: grouped });
}

export async function handleGetById(store: Store, { id }: { id: number }): Promise<MCPContent> {
  const task = store.getById(id);
  if (!task) return notFoundError(id, store);
  return text({ task });
}

export async function handleGetByScope(store: Store, { scope, status, project }: { scope: string; status?: StatusFilter; project?: string }, ctx: SessionContext): Promise<MCPContent> {
  const p = resolveProject(store, ctx, project);
  if (typeof p !== 'string') return p;
  return text({ scope, tasks: store.getByScope(p, scope, status).map(toListTask) });
}

export async function handleGetByExternalId(store: Store, { externalId }: { externalId: string }): Promise<MCPContent> {
  return text({ externalId, tasks: store.getByExternalId(externalId).map(toListTask) });
}

export async function handleGetRelated(store: Store, { id, status }: { id: number; status?: StatusFilter }): Promise<MCPContent> {
  const result = store.getRelated(id, status);
  if (!result) return notFoundError(id, store);
  const { notes, ...anchor } = result.task;
  return text({
    task: { ...toListTask(anchor), ...(notes ? { noteCount: notes.length } : {}) },
    outbound: result.outbound.map((t) => ({ ...toListTask(t), refRelation: t.refRelation })),
    inbound:  result.inbound.map((t)  => ({ ...toListTask(t), refRelation: t.refRelation })),
  });
}

export async function handleGetScopes(store: Store, { project }: { project?: string }, ctx: SessionContext): Promise<MCPContent> {
  const p = resolveProject(store, ctx, project);
  if (typeof p !== 'string') return p;
  return text({ project: p, scopes: store.getScopes(p) });
}

export async function handleGetProjects(store: Store, ctx: SessionContext): Promise<MCPContent> {
  return text({ boundProject: ctx.project, projects: store.getProjects() });
}

// ── health ─────────────────────────────────────────────────────────────────────

type CheckResult = { symbol: '✓' | '⚠' | '✗' | '–'; line: string };

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
        : check('✗', 'PROJECT_NAME missing or empty — sessions bind to the "default" project and the UI header + tab title will be empty');
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
    return check('✗', 'TASKS_DB not set in the server env — add it to the task-manager env block in .mcp.json (or `claude mcp add -e`)');
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

const SHADOWING_COMMANDS = ['refine', 'implement', 'implement-as-coordinator', 'assess'];

function readJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8').replace(/^\uFEFF/, ''));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

// Leftovers of the pre-plugin install that silently break the plugin: copies
// in ~/.claude/commands win over the plugin's bare skill names, and a dangling
// @…/SETUP.md import is ignored by Claude Code without an error.
function pluginChecks(homeDir: string): CheckResult[] {
  const claudeDir = join(homeDir, '.claude');
  const results: CheckResult[] = [];

  const installed = readJson(join(claudeDir, 'plugins', 'installed_plugins.json'))?.['plugins'];
  const installedId = installed && typeof installed === 'object'
    ? Object.keys(installed).find((k) => k.startsWith('task-manager@'))
    : undefined;
  const enabled = readJson(join(claudeDir, 'settings.json'))?.['enabledPlugins'] as Record<string, unknown> | undefined;
  if (!installedId) {
    results.push(check('✗', 'task-manager plugin not installed — run: claude plugin marketplace add dabalroman/mcp-servers && claude plugin install task-manager@dabalroman --scope user'));
  } else if (enabled?.[installedId] === false) {
    results.push(check('✗', `${installedId} installed but disabled — run: claude plugin enable ${installedId}`));
  } else {
    results.push(check('✓', `${installedId} installed`));
  }

  const shadowing = SHADOWING_COMMANDS.map((n) => join(claudeDir, 'commands', `${n}.md`)).filter((p) => existsSync(p));
  results.push(shadowing.length > 0
    ? check('✗', `Old skill copies shadow the plugin: ${shadowing.join(', ')} — delete them`)
    : check('✓', 'No old skill copies in ~/.claude/commands'));

  let claudeMd = '';
  try { claudeMd = readFileSync(join(claudeDir, 'CLAUDE.md'), 'utf-8'); } catch { /* none */ }
  const setupImport = claudeMd.split(/\r?\n/).find((l) => /^@.*simple-task-manager\/SETUP\.md\s*$/.test(l.trim()));
  results.push(setupImport
    ? check('✗', `~/.claude/CLAUDE.md still imports ${setupImport.trim()} (file removed; the plugin replaces it) — remove that line`)
    : check('✓', 'No SETUP.md import in ~/.claude/CLAUDE.md'));

  return results;
}

// Values come from the env this process actually got, so user/local-scope
// bindings (`claude mcp add`, no .mcp.json) report correctly. .mcp.json is
// only scanned for legacy/unknown keys when one is found above the cwd.
function configChecksFromEnv(envValue: (key: string) => string): CheckResult[] {
  const configChecks: CheckResult[] = [];
  for (const key of ENV_ORDER) {
    configChecks.push(validateCanonicalEnv(key, envValue(key)));
  }

  const mcpJsonPath = findMcpJson(process.cwd());
  if (mcpJsonPath) {
    let fileEnv: Record<string, unknown> = {};
    try {
      const mcpConfig = JSON.parse(readFileSync(mcpJsonPath, 'utf-8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
      const servers = mcpConfig['mcpServers'];
      const entry = (servers && typeof servers === 'object' && !Array.isArray(servers))
        ? (servers as Record<string, unknown>)['task-manager']
        : undefined;
      const envBlock = (entry && typeof entry === 'object' && !Array.isArray(entry))
        ? (entry as Record<string, unknown>)['env']
        : undefined;
      if (envBlock && typeof envBlock === 'object' && !Array.isArray(envBlock)) fileEnv = envBlock as Record<string, unknown>;
    } catch {
      configChecks.push(check('✗', `.mcp.json found at ${mcpJsonPath} but failed to parse — check JSON syntax`));
    }
    for (const key of Object.keys(fileEnv)) {
      if (ENV_ORDER.includes(key)) continue;
      const legacyHint = LEGACY_ENV_KEYS[key];
      if (legacyHint) {
        configChecks.push(check('✗', `${key} — ${legacyHint}`));
      } else {
        configChecks.push(check('⚠', `${key} — unknown, not consumed by MCP`));
      }
    }
  }

  return configChecks;
}

export async function handleHealth(binding?: { store: Store; ctx: SessionContext }, opts: { homeDir?: string } = {}): Promise<MCPContent> {
  const sections: string[] = [];

  const http = binding?.ctx.transport === 'http';
  if (binding) {
    const { project } = binding.ctx;
    const fix = http ? 'the X-Project header' : 'PROJECT_NAME';
    sections.push(renderSection('Project', [
      check('✓', http ? 'Transport = http (project from X-Project header)' : 'Transport = stdio'),
      binding.store.hasProject(project)
        ? check('✓', `Bound project = ${project} (exists)`)
        : check('✗', `Bound project = ${project} — does not exist; create it with createProject or in the task-manager UI, or fix ${fix}`),
    ]));
  }

  const envValue = (key: string): string => process.env[key] ?? '';
  if (http) {
    // process.env is the UI server process's env, not the client's, and
    // ~/.claude would be the server host's.
    sections.push(renderSection('Config (env) · Plugin', [check('–', 'skipped over HTTP: these describe a stdio server\'s env and the client machine; run health from a stdio session to check them')]));
  } else {
    sections.push(renderSection('Config (env)', configChecksFromEnv(envValue)));
    sections.push(renderSection('Plugin', pluginChecks(opts.homeDir ?? homedir())));
  }

  const uiModeRaw = envValue('TASK_UI_MODE');
  const uiPort = envValue('TASK_UI_PORT');
  const tasksDb = envValue('TASKS_DB');

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
    ? `is the standalone pm2 process running? Try \`pm2 status ${pm2AppName(uiPort)}\``
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
  const dbPath = tasksDb;
  if (!dbPath) {
    runtimeChecks.push(check('✗', 'DB migration check skipped — TASKS_DB not configured'));
  } else if (!existsSync(dbPath)) {
    runtimeChecks.push(check('⚠', `DB migration check skipped — ${dbPath} does not exist yet`));
  } else {
    try {
      const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
      let shipped: string[] = [];
      try {
        const files = readdirSync(migrationsDir);
        const ext = files.some((f) => f.endsWith('.js')) ? '.js' : '.ts';
        shipped = files.filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length));
      } catch { /* migrations dir not found */ }

      const db = new Database(dbPath, { readonly: true });
      // Short busy_timeout so health doesn't spuriously fail mid-migration or
      // during a large write — but stays bounded if something's actually stuck.
      db.pragma('busy_timeout = 2000');
      let applied: { name: string; applied_at: string }[] = [];
      try {
        applied = db.prepare<[], { name: string; applied_at: string }>('SELECT name, applied_at FROM schema_migrations ORDER BY version').all();
      } finally {
        db.close();
      }

      const unknown = applied.map((r) => r.name).filter((n) => !shipped.includes(n));
      const last = applied.at(-1);
      if (shipped.length === 0) {
        runtimeChecks.push(check('⚠', `DB schema check — could not determine migration file count (migrations dir missing or empty)`));
      } else if (unknown.length > 0) {
        runtimeChecks.push(check('✗', staleSchemaMessage(unknown)));
      } else if (applied.length === shipped.length) {
        runtimeChecks.push(check('✓', `DB schema up to date (${applied.length} migrations, last ${last?.name} applied ${last?.applied_at} UTC)`));
      } else {
        runtimeChecks.push(check('✗', `DB schema out of date — ${applied.length}/${shipped.length} migrations applied. Restart the MCP to apply pending migrations.`));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      runtimeChecks.push(check('✗', `DB migration check failed — ${msg}`));
    }
  }

  sections.push(renderSection('Runtime', runtimeChecks));

  // ── Version section ──────────────────────────────────────────────────────────
  sections.push(renderSection('Version', [await buildVersionCheck(uiMode, uiPort)]));

  return buildOutput(sections, uiMode);
}

async function buildVersionCheck(uiMode: 'standalone' | 'disabled' | 'bundled', uiPort: string): Promise<CheckResult> {
  const update = await checkForUpdate();
  if (update.state === 'current') {
    return check('✓', `Version v${update.local} is up to date`);
  }
  if (update.state === 'unknown') {
    return check('⚠', `Update check unavailable (v${update.local})`);
  }
  const steps = [
    `git -C ${PACKAGE_DIR} pull`,
    `npx tsx ${resolve(PACKAGE_DIR, 'install.ts')} in each project`,
    'restart Claude Code',
  ];
  if (uiMode === 'standalone') steps.push(`pm2 restart ${pm2AppName(uiPort)}`);
  return check('⚠', `Update available: v${update.remote} (local v${update.local}) — ${steps.join('; ')}`);
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
    displayInstruction: 'Present this health report to the user as a markdown table with three columns: Status (✓/⚠/✗/–), Category (Project / Config / Plugin / Runtime / Version), and Message. Each indented check line is one table row.',
  });
}

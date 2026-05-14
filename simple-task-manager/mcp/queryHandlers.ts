import { readdirSync, existsSync, accessSync, constants as fsConstants, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as http from 'node:http';
import { networkInterfaces } from 'node:os';
import Database from 'better-sqlite3';
import { text, toListTask, notFoundError, type MCPContent } from './shared.js';
import type { Store, Task, TaskStatus, TaskType } from '../tasks.js';

export function handleGetByType(store: Store, { type }: { type: TaskType }): MCPContent {
  return text({ tasks: store.getByType(type).map(toListTask) });
}

export function handleGetOverview(store: Store): MCPContent {
  return text({ overview: store.getOverview() });
}

export function handleGetNext(store: Store, { type }: { type?: TaskType } = {}): MCPContent {
  const task = store.getNext(type);
  return text({ task: task ? toListTask(task) : null });
}

export function handleGetAll(store: Store): MCPContent {
  const allTypes: TaskType[] = ['bug', 'feature', 'idea', 'tool', 'other'];
  const grouped: Record<string, (Task | Omit<Task, 'description'>)[]> = {};
  for (const type of allTypes) {
    const ofType = store.getByType(type).filter((t) => t.status !== 'done').map(toListTask);
    if (ofType.length > 0) grouped[type] = ofType;
  }
  return text({ tasks: grouped });
}

export function handleGetById(store: Store, { id }: { id: number }): MCPContent {
  const task = store.getById(id);
  if (!task) return notFoundError(id, store);
  return text({ task });
}

export function handleGetByScope(store: Store, { scope }: { scope: string }): MCPContent {
  return text({ scope, tasks: store.getByScope(scope).map(toListTask) });
}

export function handleGetRelated(store: Store, { id }: { id: number }): MCPContent {
  const result = store.getRelated(id);
  if (!result) return notFoundError(id, store);
  return text({
    task: result.task,
    outbound: result.outbound.map((t) => ({ ...toListTask(t), refRelation: t.refRelation })),
    inbound:  result.inbound.map((t)  => ({ ...toListTask(t), refRelation: t.refRelation })),
  });
}

export function handleGetByStatus(store: Store, { status, scope }: { status: TaskStatus; scope?: string }): MCPContent {
  return text({ tasks: store.getByStatus(status, scope).map(toListTask) });
}

export function handleGetScopes(store: Store): MCPContent {
  return text({ scopes: store.getScopes() });
}

// ── ui-health ──────────────────────────────────────────────────────────────────

type CheckResult = { symbol: '✓' | '⚠' | '✗'; line: string };

function check(symbol: CheckResult['symbol'], line: string): CheckResult {
  return { symbol, line };
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

export async function handleUiHealth(): Promise<MCPContent> {
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

  // Check TASKS_DB
  const tasksDb = typeof env['TASKS_DB'] === 'string' ? env['TASKS_DB'] : '';
  if (!tasksDb) {
    configChecks.push(check('✗', 'TASKS_DB not set in .mcp.json — add it to mcpServers.task-manager.env'));
  } else {
    const dbExists = existsSync(tasksDb);
    if (dbExists) {
      configChecks.push(check('✓', `TASKS_DB = ${tasksDb} (exists, writable)`));
    } else {
      // Check if parent directory is writable
      const parentDir = dirname(tasksDb);
      let parentWritable = false;
      try {
        accessSync(parentDir, fsConstants.W_OK);
        parentWritable = true;
      } catch { /* not writable */ }
      if (parentWritable) {
        configChecks.push(check('✓', `TASKS_DB = ${tasksDb} (does not exist yet, parent directory writable)`));
      } else {
        configChecks.push(check('✗', `TASKS_DB = ${tasksDb} — file does not exist and parent directory is not writable`));
      }
    }
  }

  // Check optional keys
  const uiPort = typeof env['TASK_UI_PORT'] === 'string' ? env['TASK_UI_PORT'] : '';
  const uiDisable = typeof env['TASK_UI_DISABLE'] === 'string' ? env['TASK_UI_DISABLE'] : '';
  const autoOpen = typeof env['AUTO_OPEN_TASK_UI'] === 'string' ? env['AUTO_OPEN_TASK_UI'] : '';

  if (!uiPort) {
    configChecks.push(check('⚠', 'TASK_UI_PORT not set — defaulting to 7374'));
  } else {
    configChecks.push(check('✓', `TASK_UI_PORT = ${uiPort}`));
  }

  if (!autoOpen) {
    configChecks.push(check('⚠', 'AUTO_OPEN_TASK_UI not set — UI will not auto-open in browser'));
  } else {
    configChecks.push(check('✓', `AUTO_OPEN_TASK_UI = ${autoOpen}`));
  }

  if (!uiDisable) {
    configChecks.push(check('⚠', 'TASK_UI_DISABLE not set — UI spawn enabled'));
  } else {
    configChecks.push(check('✓', `TASK_UI_DISABLE = ${uiDisable}`));
  }

  sections.push(renderSection('Config (.mcp.json)', configChecks));

  // ── Runtime section ──────────────────────────────────────────────────────────
  const runtimeChecks: CheckResult[] = [];
  const resolvedPort = uiPort || '7374';
  const probeUrl = `http://localhost:${resolvedPort}/`;
  const displayUrl = `http://${getLanIp()}:${resolvedPort}/`;

  try {
    const statusCode = await probeHttp(probeUrl, 2000);
    if (statusCode >= 200 && statusCode < 400) {
      runtimeChecks.push(check('✓', `UI reachable at ${probeUrl} · ${displayUrl}`));
    } else {
      runtimeChecks.push(check('✗', `UI at ${probeUrl} returned HTTP ${statusCode} — is the MCP running?`));
    }
  } catch {
    runtimeChecks.push(check('✗', `UI not reachable at ${probeUrl} — is the MCP running?`));
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

  return buildOutput(sections);
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

function buildOutput(sections: string[]): MCPContent {
  const divider = '─'.repeat(9);
  const body = sections.join('\n\n');
  const report = `ui-health\n${divider}\n${body}`;
  return text({
    report,
    displayInstruction: 'Present this health report to the user as a markdown table with three columns: Status (✓/⚠/✗), Category (Config / Runtime / Skills), and Message. Each indented check line is one table row.',
  });
}

// SQLite-backed task store.
// Schema is managed by file-per-migration in ./migrations/.
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export type TaskType = 'bug' | 'feature' | 'idea' | 'tool' | 'other';
export type TaskStatus = 'refinement' | 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export type Relation =
  | 'blocks' | 'is blocked by'
  | 'depends on' | 'is depended on by'
  | 'causes' | 'is caused by'
  | 'tests' | 'is tested by'
  | 'relates to'
  | (string & {});

export type Ref = {
  id: number;
  relation: Relation;
  nonCanonical?: boolean;
};

export type Task = {
  id: number;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  scope?: string;
  summary?: string;
  description?: string;
  plan?: string;
  refs?: Ref[];
};

const PRIORITY_ORDER: Record<TaskPriority, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const STATUS_ORDER: Record<TaskStatus, number> = { in_progress: 3, refinement: 2, todo: 1, done: 0 };
const ALL_TYPES: TaskType[] = ['bug', 'feature', 'idea', 'tool', 'other'];

export const RELATIONS = [
  'blocks', 'is blocked by',
  'depends on', 'is depended on by',
  'causes', 'is caused by',
  'tests', 'is tested by',
  'relates to',
] as const;

const INVERSE: Record<string, string> = {
  'blocks':            'is blocked by',
  'is blocked by':     'blocks',
  'depends on':        'is depended on by',
  'is depended on by': 'depends on',
  'causes':            'is caused by',
  'is caused by':      'causes',
  'tests':             'is tested by',
  'is tested by':      'tests',
  'relates to':        'relates to',
};

// ── Migration runner ──────────────────────────────────────────────────────────
//
// Each migration is a .ts/.js file in ./migrations/ named YYYYMMDDHHMMSS_slug.
// It must export:
//   export const name: string   — must equal filename stem (copy-paste guard)
//   export function up(db: DB): void
//
// The authoritative key is `name`; `version` in schema_migrations is the
// 1-based ordinal of applied migrations, kept for backward compat with existing rows.
//
// One-time backfills: rows written by the old inline-MIGRATIONS code used short
// names (no timestamp prefix). On first open after upgrading, each old name is
// renamed to its timestamp-prefixed equivalent. All three UPDATE statements are
// no-ops on new DBs and on already-upgraded DBs.

type MigrationModule = { name: string; up: (db: DB) => void };

function loadMigrations(): MigrationModule[] {
  // In dev, tsx sets __dirname to the source directory (where tasks.ts lives),
  // so path.join(__dirname, 'migrations') finds ./migrations/ next to tasks.ts.
  // In prod, tsc compiles to dist/ with migrations/ copied alongside, so
  // path.join(__dirname, 'migrations') finds dist/migrations/ correctly.
  const migrationsDir = join(__dirname, 'migrations');
  const requireModule = createRequire(import.meta.url);

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
    .sort(); // ascending by filename = chronological order

  return files.map((file) => {
    const stem = basename(file, file.endsWith('.ts') ? '.ts' : '.js');
    const mod = requireModule(join(migrationsDir, file)) as MigrationModule;
    if (mod.name !== stem) {
      throw new Error(
        `Migration file mismatch: file "${file}" exports name="${mod.name}" but expected "${stem}". ` +
        `Rename the export or the file to match.`
      );
    }
    return mod;
  });
}

function runMigrations(db: DB): void {
  // Ensure schema_migrations table exists — it's the authoritative record.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // One-time backfills: rename old inline-array names to timestamp-prefixed file names.
  // These run on first open after upgrading from the inline-MIGRATIONS code and are
  // no-ops on new or already-upgraded DBs.
  db.prepare(`UPDATE schema_migrations SET name='20260101000000_initial-schema' WHERE version=1 AND name='initial-schema'`).run();
  db.prepare(`UPDATE schema_migrations SET name='20260513000000_normalize-literal-newlines' WHERE version=2 AND name='normalize-literal-newlines'`).run();
  db.prepare(`UPDATE schema_migrations SET name='20260513000001_refs-pk-simplify' WHERE version=3 AND name='refs_pk_simplify'`).run();

  const migrations = loadMigrations();
  const onDiskNames = new Set(migrations.map((m) => m.name));

  const appliedRows = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as
    { version: number; name: string }[];
  const appliedNames = new Set(appliedRows.map((r) => r.name));

  // Downgrade guard: applied name not present on disk means a newer code version ran.
  const missing = [...appliedNames].filter((n) => !onDiskNames.has(n));
  if (missing.length > 0) {
    throw new Error(
      `DB was migrated by newer code; downgrade not supported. Missing migration files: ${missing.join(', ')}`
    );
  }

  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (version, name) VALUES (?, ?)'
  );

  // version = 1-based ordinal of all applied migrations after this run
  let nextVersion = appliedRows.length + 1;

  for (const migration of migrations) {
    if (appliedNames.has(migration.name)) continue;
    db.transaction(() => {
      migration.up(db);
      insertMigration.run(nextVersion, migration.name);
    })();
    appliedNames.add(migration.name);
    nextVersion++;
  }

  // Keep user_version in sync with total number of applied migrations for
  // backward compatibility with tooling that reads it.
  const finalCount = (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n;
  db.pragma(`user_version = ${finalCount}`);
}

// ── Row mapping ───────────────────────────────────────────────────────────────
type TaskRow = {
  id: number;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  scope: string | null;
  summary: string | null;
  description: string | null;
  plan: string | null;
};

type RefRow = { from_id: number; to_id: number; relation: string; non_canonical: number };

function rowToTask(row: TaskRow, refs: Ref[]): Task {
  const t: Task = {
    id: row.id,
    title: row.title,
    type: row.type,
    status: row.status,
    priority: row.priority,
  };
  if (row.scope) t.scope = row.scope;
  if (row.summary) t.summary = row.summary;
  t.description = row.description ?? '';
  if (row.plan) t.plan = row.plan;
  if (refs && refs.length) t.refs = refs;
  return t;
}

function refRowToObj(r: RefRow): Ref {
  const out: Ref = { id: r.to_id, relation: r.relation };
  if (r.non_canonical) out.nonCanonical = true;
  return out;
}

// Defensive guard: Claude sometimes emits literal \n (0x5C 0x6E) as text tokens
// in MCP tool call arguments instead of real newline bytes (0x0A).
function normalizeNewlines(s: string): string;
function normalizeNewlines<T>(s: T): T;
function normalizeNewlines(s: unknown): unknown {
  return typeof s === 'string' ? s.replace(/\\n/g, '\n') : s;
}

// ── Helpers (pure) ────────────────────────────────────────────────────────────
export function sortByPriority<T extends { priority: TaskPriority; id: number }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const pd = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
    return pd !== 0 ? pd : b.id - a.id;
  });
}

export function sortForNext<T extends { status: TaskStatus; priority: TaskPriority; id: number }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const sd = STATUS_ORDER[b.status] - STATUS_ORDER[a.status];
    if (sd !== 0) return sd;
    const pd = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
    return pd !== 0 ? pd : b.id - a.id;
  });
}

export type AddInput = {
  type: TaskType;
  priority: TaskPriority;
  title: string;
  description?: string;
  scope?: string;
  summary?: string;
  plan?: string;
  refs?: Ref[];
  status?: TaskStatus;
};

export type UpdatePatch = {
  title?: string;
  type?: TaskType;
  priority?: TaskPriority;
  description?: string;
  scope?: string | null;
  summary?: string | null;
  plan?: string | null;
  refs?: Ref[] | null;
};

export type LoadResult = {
  counter: number;
  active: Task[];
  done: Task[];
};

export type RelatedResult = {
  task: Task;
  outbound: (Task & { refRelation: string })[];
  inbound: (Task & { refRelation: string })[];
};

export type OverviewEntry = { type: TaskType; refinement: number; open: number; done: number };
export type ScopeEntry = { scope: string; total: number; open: number };

export type StatusFilter = TaskStatus | 'open';

// Expands 'open' or undefined to the list of non-done statuses.
// 'open' and undefined both mean non-done; a specific TaskStatus means exact match.
export function resolveStatusFilter(status?: StatusFilter): TaskStatus[] | TaskStatus {
  if (status === undefined || status === 'open') {
    return ['refinement', 'todo', 'in_progress'];
  }
  return status;
}

export type Store = {
  readonly db: DB;
  dataVersion(): number;
  load(): LoadResult;
  add(input: AddInput): { id: number };
  update(id: number, patch: UpdatePatch): { task: Task } | null;
  setStatus(id: number, status: TaskStatus): boolean;
  delete(id: number): boolean;
  getByStatus(status: TaskStatus, scope?: string): Task[];
  getByScope(scope: string, status?: StatusFilter): Task[];
  getByType(type: TaskType, status?: StatusFilter): Task[];
  getNext(type?: TaskType): Task | null;
  getOverview(status?: StatusFilter): OverviewEntry[];
  getRelated(id: number, status?: StatusFilter): RelatedResult | null;
  getScopes(): ScopeEntry[];
  getById(id: number): Task | null;
  getAll(status?: StatusFilter): Task[];
  close(): void;
};

// ── Store factory ─────────────────────────────────────────────────────────────
export function createStore(dbPath: string): Store {
  if (!dbPath) throw new Error('createStore: dbPath is required');

  const db = new Database(dbPath);
  // journal_mode = DELETE (the default) — WAL was tried first but its mmap'd
  // shared-memory region (`tasks.db-shm`) does not stay coherent when the
  // writer (host-side MCP) and reader (containerised random-tools API) live
  // in different VFS namespaces over a Docker bind mount: readers kept stale
  // snapshots until checkpoint, breaking SSE live updates. DELETE journaling
  // coordinates via POSIX advisory locks on the main DB file, which is
  // bind-mount-safe. Write contention is irrelevant at this scale (tens of
  // writes per session).
  db.pragma('journal_mode = DELETE');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  // Prepared statements
  const stmtGetCounter      = db.prepare("SELECT value FROM meta WHERE key = 'counter'");
  const stmtSetCounter      = db.prepare("UPDATE meta SET value = ? WHERE key = 'counter'");
  const stmtInsertTask      = db.prepare(
    'INSERT INTO tasks (id, title, type, status, priority, scope, summary, description, plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const stmtSelectTask      = db.prepare('SELECT * FROM tasks WHERE id = ?');
  const stmtSelectAllTasks  = db.prepare('SELECT * FROM tasks');
  const stmtSelectAllIds    = db.prepare('SELECT id FROM tasks ORDER BY id');
  const stmtDeleteTask      = db.prepare('DELETE FROM tasks WHERE id = ?');
  const stmtRefsFrom        = db.prepare('SELECT from_id, to_id, relation, non_canonical FROM refs WHERE from_id = ?');
  const stmtRefsAll         = db.prepare('SELECT from_id, to_id, relation, non_canonical FROM refs');
  const stmtInsertRef       = db.prepare(
    'INSERT OR REPLACE INTO refs (from_id, to_id, relation, non_canonical) VALUES (?, ?, ?, ?)'
  );
  const stmtDeleteRefsFrom  = db.prepare('DELETE FROM refs WHERE from_id = ?');
  const stmtUpdateRefRelation = db.prepare(
    'UPDATE refs SET relation = ? WHERE from_id = ? AND to_id = ?'
  );
  const stmtDeleteMirror    = db.prepare('DELETE FROM refs WHERE from_id = ? AND to_id = ? AND relation = ?');
  const stmtUpdateTask      = db.prepare(`
    UPDATE tasks
    SET title = ?, type = ?, priority = ?, scope = ?, summary = ?, description = ?, plan = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  const stmtSetTaskStatus   = db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`);

  function getCounter(): number {
    const row = stmtGetCounter.get() as { value: string } | undefined;
    return parseInt(row?.value ?? '0', 10);
  }
  function setCounter(n: number): void { stmtSetCounter.run(String(n)); }

  function readRefsFor(id: number): Ref[] {
    return (stmtRefsFrom.all(id) as RefRow[]).map(refRowToObj);
  }

  function readTask(id: number): Task | null {
    const row = stmtSelectTask.get(id) as TaskRow | undefined;
    if (!row) return null;
    return rowToTask(row, readRefsFor(id));
  }

  function readAllTasks(): Task[] {
    const rows = stmtSelectAllTasks.all() as TaskRow[];
    if (rows.length === 0) return [];
    const refsByFrom = new Map<number, Ref[]>();
    for (const r of stmtRefsAll.all() as RefRow[]) {
      const arr = refsByFrom.get(r.from_id) ?? [];
      arr.push(refRowToObj(r));
      refsByFrom.set(r.from_id, arr);
    }
    return rows.map((row) => rowToTask(row, refsByFrom.get(row.id) ?? []));
  }

  function getValidIds(): Set<number> {
    return new Set((stmtSelectAllIds.all() as { id: number }[]).map((r) => r.id));
  }

  // Apply refs change for a single source task. Mirrors canonical refs and removes
  // mirrors when refs are removed/changed. Mutates the refs table; callers wrap
  // in a transaction.
  function applyRefsImpl(sourceId: number, oldRefs: Ref[], nextRefs: Ref[] | null | undefined): Ref[] {
    const validIds = getValidIds();
    const cleanedNext = (nextRefs ?? []).filter((r) => {
      if (r.id === sourceId) return false;
      if (!validIds.has(r.id)) return false;
      return true;
    });

    const canonOld = (oldRefs ?? []).filter((r) => !r.nonCanonical);
    const canonNext = cleanedNext.filter((r) => !r.nonCanonical);

    // Wipe source's outbound, re-insert from cleaned set.
    stmtDeleteRefsFrom.run(sourceId);
    for (const r of cleanedNext) {
      stmtInsertRef.run(sourceId, r.id, r.relation, r.nonCanonical ? 1 : 0);
    }

    const added = canonNext.filter((r) => !canonOld.some((o) => o.id === r.id));
    const removed = canonOld.filter((r) => !canonNext.some((n) => n.id === r.id));
    const changed = canonNext.filter((r) => {
      const old = canonOld.find((o) => o.id === r.id);
      return old && old.relation !== r.relation;
    });

    for (const ref of added) {
      const inverse = INVERSE[ref.relation as string] ?? ref.relation;
      stmtInsertRef.run(ref.id, sourceId, inverse, 0);
    }
    for (const ref of removed) {
      // Remove only the specific mirror: the inverse relation we wrote when this ref was added.
      const inverse = INVERSE[ref.relation as string] ?? ref.relation;
      stmtDeleteMirror.run(ref.id, sourceId, inverse);
    }
    for (const ref of changed) {
      const inverse = INVERSE[ref.relation as string] ?? ref.relation;
      stmtUpdateRefRelation.run(inverse, ref.id, sourceId);
    }

    return cleanedNext;
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  function load(): LoadResult {
    const all = readAllTasks();
    const counter = getCounter();
    const active = all.filter((t) => t.status !== 'done');
    const done = all.filter((t) => t.status === 'done');
    return { counter, active, done };
  }

  function add(input: AddInput): { id: number } {
    const { type, priority, title, description = '', scope, summary, plan, refs, status = 'refinement' } = input;
    const trimmedTitle = normalizeNewlines(String(title ?? '').trim());
    if (!trimmedTitle) throw new Error('Validation failed: title must not be empty or whitespace-only.');

    return db.transaction(() => {
      const newId = getCounter() + 1;
      stmtInsertTask.run(
        newId,
        trimmedTitle,
        type,
        status,
        priority,
        scope?.trim() || null,
        summary?.trim() || null,
        normalizeNewlines(description.trim()),
        plan?.trim() || null
      );
      setCounter(newId);

      if (refs?.length) {
        applyRefsImpl(newId, [], refs);
      }
      return { id: newId };
    })();
  }

  function update(id: number, patch: UpdatePatch): { task: Task } | null {
    return db.transaction(() => {
      const existing = stmtSelectTask.get(id) as TaskRow | undefined;
      if (!existing) return null;

      const next = {
        title: patch.title !== undefined ? normalizeNewlines(patch.title.trim()) : existing.title,
        type: patch.type ?? existing.type,
        priority: patch.priority ?? existing.priority,
        scope: patch.scope === null
          ? null
          : patch.scope !== undefined ? (patch.scope.trim() || null) : existing.scope,
        summary: patch.summary === null
          ? null
          : patch.summary !== undefined ? (patch.summary.trim() || null) : existing.summary,
        description: patch.description !== undefined ? normalizeNewlines(patch.description.trim()) : existing.description,
        plan: patch.plan === null
          ? null
          : patch.plan !== undefined ? (patch.plan.trim() || null) : existing.plan,
      };

      stmtUpdateTask.run(next.title, next.type, next.priority, next.scope, next.summary, next.description, next.plan, id);

      if (patch.refs !== undefined) {
        const oldRefs = readRefsFor(id);
        const nextRefs: Ref[] = patch.refs === null || patch.refs.length === 0 ? [] : patch.refs;
        applyRefsImpl(id, oldRefs, nextRefs);
      }

      const task = readTask(id);
      return task ? { task } : null;
    })();
  }

  function setStatus(id: number, status: TaskStatus): boolean {
    return db.transaction(() => {
      const existing = stmtSelectTask.get(id);
      if (!existing) return false;
      stmtSetTaskStatus.run(status, id);
      return true;
    })();
  }

  function deleteTask(id: number): boolean {
    return db.transaction(() => {
      const existing = stmtSelectTask.get(id);
      if (!existing) return false;
      // FK ON DELETE CASCADE handles refs in both directions.
      stmtDeleteTask.run(id);
      return true;
    })();
  }

  function getByStatus(status: TaskStatus, scope?: string): Task[] {
    let rows: TaskRow[];
    if (scope !== undefined) {
      rows = db.prepare('SELECT * FROM tasks WHERE status = ? AND scope = ?').all(status, scope) as TaskRow[];
    } else {
      rows = db.prepare('SELECT * FROM tasks WHERE status = ?').all(status) as TaskRow[];
    }
    const tasks = rows.map((row) => rowToTask(row, readRefsFor(row.id)));
    return sortByPriority(tasks);
  }

  function getByScope(scope: string, status?: StatusFilter): Task[] {
    const resolved = resolveStatusFilter(status);
    let rows: TaskRow[];
    if (Array.isArray(resolved)) {
      const placeholders = resolved.map(() => '?').join(', ');
      rows = db.prepare(`SELECT * FROM tasks WHERE scope = ? AND status IN (${placeholders})`).all(scope, ...resolved) as TaskRow[];
    } else {
      rows = db.prepare('SELECT * FROM tasks WHERE scope = ? AND status = ?').all(scope, resolved) as TaskRow[];
    }
    const tasks = rows.map((row) => rowToTask(row, readRefsFor(row.id)));
    return sortByPriority(tasks);
  }

  function getByType(type: TaskType, status?: StatusFilter): Task[] {
    const resolved = resolveStatusFilter(status);
    let rows: TaskRow[];
    if (Array.isArray(resolved)) {
      const placeholders = resolved.map(() => '?').join(', ');
      rows = db.prepare(`SELECT * FROM tasks WHERE type = ? AND status IN (${placeholders})`).all(type, ...resolved) as TaskRow[];
    } else {
      rows = db.prepare('SELECT * FROM tasks WHERE type = ? AND status = ?').all(type, resolved) as TaskRow[];
    }
    const tasks = rows.map((row) => rowToTask(row, readRefsFor(row.id)));
    return sortByPriority(tasks);
  }

  function getNext(type?: TaskType): Task | null {
    let rows: TaskRow[];
    if (type) {
      rows = db.prepare(`
        SELECT * FROM tasks
        WHERE status IN ('todo', 'in_progress', 'refinement')
        AND type = ?
      `).all(type) as TaskRow[];
    } else {
      rows = db.prepare(`
        SELECT * FROM tasks
        WHERE status IN ('todo', 'in_progress', 'refinement')
      `).all() as TaskRow[];
    }
    const tasks = rows.map((row) => rowToTask(row, readRefsFor(row.id)));
    const sorted = sortForNext(tasks);
    return sorted[0] ?? null;
  }

  function getOverview(status?: StatusFilter): OverviewEntry[] {
    const resolved = resolveStatusFilter(status);
    let whereClause: string;
    let params: string[];
    if (Array.isArray(resolved)) {
      const placeholders = resolved.map(() => '?').join(', ');
      whereClause = `WHERE status IN (${placeholders})`;
      params = resolved;
    } else {
      whereClause = 'WHERE status = ?';
      params = [resolved];
    }
    const rows = db.prepare(`
      SELECT type,
             SUM(CASE WHEN status = 'refinement' THEN 1 ELSE 0 END) AS refinement,
             SUM(CASE WHEN status IN ('todo', 'in_progress') THEN 1 ELSE 0 END) AS open,
             SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
      FROM tasks
      ${whereClause}
      GROUP BY type
    `).all(...params) as { type: TaskType; refinement: number; open: number; done: number }[];
    return ALL_TYPES
      .map((type): OverviewEntry | null => {
        const r = rows.find((x) => x.type === type);
        return r ? { type, refinement: r.refinement, open: r.open, done: r.done } : null;
      })
      .filter((o): o is OverviewEntry => o !== null && (o.refinement + o.open + o.done > 0))
      .sort((a, b) => b.open - a.open);
  }

  function getById(id: number): Task | null {
    return readTask(id);
  }

  function getAll(status?: StatusFilter): Task[] {
    const resolved = resolveStatusFilter(status);
    let rows: TaskRow[];
    if (Array.isArray(resolved)) {
      const placeholders = resolved.map(() => '?').join(', ');
      rows = db.prepare(`SELECT * FROM tasks WHERE status IN (${placeholders})`).all(...resolved) as TaskRow[];
    } else {
      rows = db.prepare('SELECT * FROM tasks WHERE status = ?').all(resolved) as TaskRow[];
    }
    const tasks = rows.map((row) => rowToTask(row, readRefsFor(row.id)));
    return sortByPriority(tasks);
  }

  function getRelated(id: number, status?: StatusFilter): RelatedResult | null {
    const task = readTask(id);
    if (!task) return null;

    const resolved = resolveStatusFilter(status);
    function matchesStatus(t: Task): boolean {
      if (Array.isArray(resolved)) return resolved.includes(t.status);
      return t.status === resolved;
    }

    // Outbound = task's own refs (already on task.refs after readTask).
    const outbound = (task.refs ?? []).flatMap((ref) => {
      const t = readTask(ref.id);
      return t && matchesStatus(t) ? [{ ...t, refRelation: ref.relation as string }] : [];
    });

    // Inbound = other tasks pointing at this task.
    const inboundRefs = db.prepare(
      'SELECT from_id, relation FROM refs WHERE to_id = ? AND from_id != ?'
    ).all(id, id) as { from_id: number; relation: string }[];
    const inbound = inboundRefs.flatMap((r) => {
      const t = readTask(r.from_id);
      return t && matchesStatus(t) ? [{ ...t, refRelation: r.relation }] : [];
    });

    return { task, outbound, inbound };
  }

  function getScopes(): ScopeEntry[] {
    const rows = db.prepare(`
      SELECT scope,
             COUNT(*) AS total,
             SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END) AS open
      FROM tasks
      WHERE scope IS NOT NULL
      GROUP BY scope
    `).all() as { scope: string; total: number; open: number }[];
    return rows
      .map((r) => ({ scope: r.scope, total: r.total, open: r.open }))
      .sort((a, b) => {
        if (b.open !== a.open) return b.open - a.open;
        if (b.total !== a.total) return b.total - a.total;
        return a.scope.localeCompare(b.scope);
      });
  }

  function close(): void {
    db.close();
  }

  return {
    db, // exposed for advanced cases; avoid using directly — prefer dataVersion() for polling
    dataVersion: () => db.pragma('data_version', { simple: true }) as number,
    load,
    add,
    update,
    setStatus,
    delete: deleteTask,
    getByStatus,
    getByScope,
    getByType,
    getNext,
    getOverview,
    getRelated,
    getScopes,
    getById,
    getAll,
    close,
  };
}

// ── Pure helpers exported for tests ───────────────────────────────────────────
// Mutates allTasks in place — preserved for backward-compat with random-tools' vendor mirror.
export function applyRefs(allTasks: Task[], sourceId: number, oldRefs: Ref[] | undefined, nextRefs: Ref[] | undefined): Task[] {
  const validIds = new Set(allTasks.map((t) => t.id));
  const canonOld = (oldRefs ?? []).filter((r) => !r.nonCanonical);
  const canonNext = (nextRefs ?? []).filter((r) => {
    if (r.nonCanonical) return false;
    if (r.id === sourceId) return false;
    if (!validIds.has(r.id)) return false;
    return true;
  });

  const sourceTask = allTasks.find((t) => t.id === sourceId);
  if (sourceTask) {
    const cleaned = (nextRefs ?? []).filter((r) => r.nonCanonical || (r.id !== sourceId && validIds.has(r.id)));
    sourceTask.refs = cleaned.length ? cleaned : undefined;
  }

  const added = canonNext.filter((r) => !canonOld.some((o) => o.id === r.id));
  const removed = canonOld.filter((r) => !canonNext.some((n) => n.id === r.id));
  const changed = canonNext.filter((r) => {
    const old = canonOld.find((o) => o.id === r.id);
    return old && old.relation !== r.relation;
  });

  for (const task of allTasks) {
    if (task.id === sourceId) continue;

    for (const ref of added) {
      if (task.id !== ref.id) continue;
      const inverse = INVERSE[ref.relation as string] ?? ref.relation;
      if (!task.refs) task.refs = [];
      if (!task.refs.some((r) => r.id === sourceId)) {
        task.refs.push({ id: sourceId, relation: inverse });
      }
    }
    for (const ref of removed) {
      if (task.id !== ref.id || !task.refs) continue;
      task.refs = task.refs.filter((r) => r.id !== sourceId);
      if (task.refs.length === 0) task.refs = undefined;
    }
    for (const ref of changed) {
      if (task.id !== ref.id || !task.refs) continue;
      const inverse = INVERSE[ref.relation as string] ?? ref.relation;
      task.refs = task.refs.map((r) => (r.id === sourceId ? { ...r, relation: inverse } : r));
    }
  }
  return allTasks;
}

export function cascadeDelete(allTasks: Task[], deletedId: number): Task[] {
  for (const task of allTasks) {
    if (!task.refs) continue;
    task.refs = task.refs.filter((r) => r.id !== deletedId);
    if (task.refs.length === 0) task.refs = undefined;
  }
  return allTasks;
}

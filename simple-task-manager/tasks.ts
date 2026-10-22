// SQLite-backed task store.
// Schema is managed by file-per-migration in ./migrations/.
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export type TaskType = 'bug' | 'feature' | 'idea' | 'tool' | 'other' | 'epic';
export type TaskStatus = 'refinement' | 'plan' | 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export type Relation = typeof RELATIONS[number];

export type Ref = {
  id: number;
  relation: Relation;
  nonCanonical?: boolean;
  title?: string;
};

export type Task = {
  id: number;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  scope?: string;
  summary?: string;
  description: string;
  plan?: string;
  parentId?: number;
  epicTitle?: string;
  epic?: EpicContext;
  children?: EpicChild[];
  refs?: Ref[];
  notes?: Note[];
  noteCount?: number;
  created_at: string;
  updated_at: string;
};

export type EpicContext = {
  id: number;
  title: string;
  status: TaskStatus;
  summary?: string;
  description: string;
  notes?: Note[];
};

export type EpicChild = { id: number; title: string; status: TaskStatus; type: TaskType; priority: TaskPriority };

export type Note = {
  id: number;
  task_id: number;
  body: string;
  created_at: string;
  updated_at: string;
};

const PRIORITY_ORDER: Record<TaskPriority, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const STATUS_ORDER: Record<TaskStatus, number> = { in_progress: 4, refinement: 3, plan: 2, todo: 1, done: 0 };
export const ALL_TYPES: TaskType[] = ['bug', 'feature', 'idea', 'tool', 'other', 'epic'];

export const RELATIONS = [
  'blocks', 'is blocked by',
  'depends on', 'is depended on by',
  'causes', 'is caused by',
  'tests', 'is tested by',
  'relates to',
] as const;

const INVERSE: Record<Relation, Relation> = {
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

export function loadMigrations(dir?: string): MigrationModule[] {
  // In dev, tsx sets __dirname to the source directory (where tasks.ts lives),
  // so path.join(__dirname, 'migrations') finds ./migrations/ next to tasks.ts.
  // In prod, tsc compiles to dist/ with migrations/ copied alongside, so
  // path.join(__dirname, 'migrations') finds dist/migrations/ correctly.
  const migrationsDir = dir ?? join(__dirname, 'migrations');
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
  // Disable FKs around the migration loop. Some migrations rebuild a table by
  // CREATE-new / INSERT...SELECT / DROP / RENAME; with FKs ON, the DROP fires
  // ON DELETE CASCADE on dependent tables and wipes refs. Setting
  // foreign_keys here is a no-op if a transaction is already open, so we
  // require the caller to invoke runMigrations *before* enabling FKs.
  db.pragma('foreign_keys = OFF');
  // Brief busy_timeout so concurrent openers (bundled-mode UI spawns right
  // after the MCP calls createStore on a fresh DB) wait on the BEGIN IMMEDIATE
  // below instead of taking immediate SQLITE_BUSY.
  db.pragma('busy_timeout = 5000');

  // Wrap the entire migration bootstrap in one BEGIN IMMEDIATE so two processes
  // racing createStore() on a fresh DB serialise on the write lock instead of
  // both observing an empty schema_migrations and racing into duplicate
  // INSERTs. The loser waits on busy_timeout then re-reads schema_migrations
  // (now populated) and the loop becomes a no-op.
  db.transaction(() => {
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
      migration.up(db);
      insertMigration.run(nextVersion, migration.name);
      appliedNames.add(migration.name);
      nextVersion++;
    }

    // Keep user_version in sync with total number of applied migrations for
    // backward compatibility with tooling that reads it.
    const finalCount = (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n;
    db.pragma(`user_version = ${finalCount}`);

    // Verify no FK violations slipped in while FKs were off.
    const violations = db.prepare('PRAGMA foreign_key_check').all() as unknown[];
    if (violations.length > 0) {
      throw new Error(`Foreign key violations after migrations: ${JSON.stringify(violations)}`);
    }
  }).immediate();
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
  parent_id: number | null;
  created_at: string;
  updated_at: string;
};

type RefRow = { from_id: number; to_id: number; relation: string; non_canonical: number };

function rowToTask(row: TaskRow, refs: Ref[]): Task {
  const t: Task = {
    id: row.id,
    title: row.title,
    type: row.type,
    status: row.status,
    priority: row.priority,
    description: row.description ?? '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (row.scope) t.scope = row.scope;
  if (row.summary) t.summary = row.summary;
  if (row.plan) t.plan = row.plan;
  if (row.parent_id !== null) t.parentId = row.parent_id;
  if (refs && refs.length) t.refs = refs;
  return t;
}

function refRowToObj(r: RefRow): Ref {
  // relation was validated by zod at write time; cast is safe
  const out: Ref = { id: r.to_id, relation: r.relation as Relation };
  if (r.non_canonical) out.nonCanonical = true;
  return out;
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
  parentId?: number;
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
  parentId?: number | null;
};

export type LoadResult = {
  active: Task[];
  done: Task[];
};

export type RelatedResult = {
  task: Task;
  outbound: (Task & { refRelation: string })[];
  inbound: (Task & { refRelation: string })[];
};

export type OverviewEntry =
  | { type: TaskType; refinement: number; plan: number; open: number; done: number }
  | { type: TaskType; count: number; status: TaskStatus };
export type ScopeEntry = { scope: string; total: number; open: number };

export type StatusFilter = TaskStatus | 'open';

// Expands 'open' or undefined to the list of non-done statuses.
// 'open' and undefined both mean non-done; a specific TaskStatus means exact match.
export function resolveStatusFilter(status?: StatusFilter): TaskStatus[] | TaskStatus {
  if (status === undefined || status === 'open') {
    return ['refinement', 'plan', 'todo', 'in_progress'];
  }
  return status;
}

export type Store = {
  readonly db: DB;
  dataVersion(): number;
  load(): LoadResult;
  loadWithNotes(): LoadResult;
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
  addNote(taskId: number, body: string): Note | null;
  updateNote(noteId: number, body: string): Note | null;
  deleteNote(noteId: number): boolean;
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
  // DELETE journaling coordinates via POSIX file locks; SQLITE_BUSY is thrown
  // immediately to the loser of any write race unless we ask SQLite to retry.
  // 5s is generous for our workload (tens of writes per session) and short
  // enough that a genuinely stuck lock surfaces as an error.
  db.pragma('busy_timeout = 5000');

  // runMigrations disables FKs internally (table-rebuild migrations need it);
  // we re-enable after so normal operation enforces them. try/finally so a
  // thrown migration can't leave the connection with FKs off for its lifetime
  // — that would silently break ON DELETE CASCADE on `refs`.
  try {
    runMigrations(db);
  } finally {
    db.pragma('foreign_keys = ON');
  }

  // Prepared statements
  const stmtInsertTask      = db.prepare(
    'INSERT INTO tasks (title, type, status, priority, scope, summary, description, plan, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const stmtSelectTask      = db.prepare('SELECT * FROM tasks WHERE id = ?');
  const stmtSelectAllTasks  = db.prepare('SELECT * FROM tasks');
  const stmtSelectAllIds    = db.prepare('SELECT id FROM tasks ORDER BY id');
  const stmtDeleteTask      = db.prepare('DELETE FROM tasks WHERE id = ?');
  const stmtRefsFrom        = db.prepare('SELECT from_id, to_id, relation, non_canonical FROM refs WHERE from_id = ?');
  const stmtRefsFromTitled  = db.prepare(
    'SELECT r.from_id, r.to_id, r.relation, r.non_canonical, t.title FROM refs r JOIN tasks t ON t.id = r.to_id WHERE r.from_id = ?'
  );
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
    SET title = ?, type = ?, priority = ?, scope = ?, summary = ?, description = ?, plan = ?, parent_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  const stmtSetTaskStatus   = db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`);
  const stmtTouchTask       = db.prepare(`UPDATE tasks SET updated_at = datetime('now') WHERE id = ?`);
  const stmtInsertNote      = db.prepare('INSERT INTO notes (task_id, body) VALUES (?, ?)');
  const stmtSelectNote      = db.prepare('SELECT * FROM notes WHERE id = ?');
  const stmtNotesFor        = db.prepare('SELECT * FROM notes WHERE task_id = ? ORDER BY created_at ASC, id ASC');
  const stmtUpdateNote      = db.prepare(`UPDATE notes SET body = ?, updated_at = datetime('now') WHERE id = ?`);
  const stmtDeleteNote      = db.prepare('DELETE FROM notes WHERE id = ?');
  const stmtChildrenOf      = db.prepare('SELECT id, title, status, type, priority FROM tasks WHERE parent_id = ? ORDER BY id');
  const stmtHasChildren     = db.prepare('SELECT 1 FROM tasks WHERE parent_id = ? LIMIT 1');

  function readRefsFor(id: number): Ref[] {
    return (stmtRefsFrom.all(id) as RefRow[]).map(refRowToObj);
  }

  function readTask(id: number): Task | null {
    const row = stmtSelectTask.get(id) as TaskRow | undefined;
    if (!row) return null;
    const refs = (stmtRefsFromTitled.all(id) as (RefRow & { title: string })[])
      .map((r) => ({ ...refRowToObj(r), title: r.title }));
    const task = rowToTask(row, refs);
    const notes = stmtNotesFor.all(id) as Note[];
    if (notes.length) task.notes = notes;
    if (row.parent_id !== null) {
      const parent = stmtSelectTask.get(row.parent_id) as TaskRow | undefined;
      if (parent) task.epicTitle = parent.title;
    }
    return task;
  }

  // Throws on an invalid epic link. selfId is set on update, for the
  // "epic still has children" check when the type changes away from epic.
  function assertParent(selfType: TaskType, parentId: number | null, selfId?: number, prevType?: TaskType): void {
    if (selfId !== undefined && prevType === 'epic' && selfType !== 'epic' && stmtHasChildren.get(selfId)) {
      throw new Error(`Validation failed: epic #${selfId} still has children — move them off it first.`);
    }
    if (parentId === null) return;
    if (selfType === 'epic') throw new Error('Validation failed: epics cannot have a parent.');
    const parent = stmtSelectTask.get(parentId) as TaskRow | undefined;
    if (!parent) throw new Error(`Validation failed: parent #${parentId} does not exist.`);
    if (parent.type !== 'epic') throw new Error(`Validation failed: parent #${parentId} is not an epic.`);
  }

  function readAllTasks(withNotes = false): Task[] {
    const rows = stmtSelectAllTasks.all() as TaskRow[];
    return attachRefs(rows, withNotes);
  }

  // Bulk-load refs for a set of task rows in one query, then join in memory.
  // O(1) SQLite round-trips regardless of result set size — replaces the
  // N+1 pattern of calling readRefsFor(row.id) inside a .map().
  function attachRefs(rows: TaskRow[], withNotes = false): Task[] {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(', ');
    const refRows = db.prepare(
      `SELECT from_id, to_id, relation, non_canonical FROM refs WHERE from_id IN (${placeholders})`
    ).all(...ids) as RefRow[];
    const refsByFrom = new Map<number, Ref[]>();
    for (const r of refRows) {
      const arr = refsByFrom.get(r.from_id) ?? [];
      arr.push(refRowToObj(r));
      refsByFrom.set(r.from_id, arr);
    }
    const countRows = db.prepare(
      `SELECT task_id, COUNT(*) AS n FROM notes WHERE task_id IN (${placeholders}) GROUP BY task_id`
    ).all(...ids) as { task_id: number; n: number }[];
    const noteCounts = new Map(countRows.map((r) => [r.task_id, r.n]));
    const notesByTask = new Map<number, Note[]>();
    if (withNotes) {
      const noteRows = db.prepare(
        `SELECT id, task_id, body, created_at, updated_at FROM notes WHERE task_id IN (${placeholders}) ORDER BY created_at ASC, id ASC`
      ).all(...ids) as Note[];
      for (const n of noteRows) {
        const arr = notesByTask.get(n.task_id) ?? [];
        arr.push(n);
        notesByTask.set(n.task_id, arr);
      }
    }
    const parentIds = [...new Set(rows.flatMap((r) => (r.parent_id !== null ? [r.parent_id] : [])))];
    const epicTitles = new Map<number, string>();
    if (parentIds.length) {
      const titleRows = db.prepare(
        `SELECT id, title FROM tasks WHERE id IN (${parentIds.map(() => '?').join(', ')})`
      ).all(...parentIds) as { id: number; title: string }[];
      for (const t of titleRows) epicTitles.set(t.id, t.title);
    }
    return rows.map((row) => {
      const task = rowToTask(row, refsByFrom.get(row.id) ?? []);
      const epicTitle = row.parent_id !== null ? epicTitles.get(row.parent_id) : undefined;
      if (epicTitle !== undefined) task.epicTitle = epicTitle;
      const n = noteCounts.get(row.id);
      if (n) task.noteCount = n;
      const notes = notesByTask.get(row.id);
      if (notes) task.notes = notes;
      return task;
    });
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
      const inverse = INVERSE[ref.relation] ?? ref.relation;
      stmtInsertRef.run(ref.id, sourceId, inverse, 0);
    }
    for (const ref of removed) {
      // Remove only the specific mirror: the inverse relation we wrote when this ref was added.
      const inverse = INVERSE[ref.relation] ?? ref.relation;
      stmtDeleteMirror.run(ref.id, sourceId, inverse);
    }
    for (const ref of changed) {
      const inverse = INVERSE[ref.relation] ?? ref.relation;
      stmtUpdateRefRelation.run(inverse, ref.id, sourceId);
    }

    return cleanedNext;
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  function splitByDone(all: Task[]): LoadResult {
    const active = all.filter((t) => t.status !== 'done');
    const done = all.filter((t) => t.status === 'done');
    return { active, done };
  }

  function load(): LoadResult {
    return splitByDone(readAllTasks());
  }

  function loadWithNotes(): LoadResult {
    return splitByDone(readAllTasks(true));
  }

  function add(input: AddInput): { id: number } {
    const { type, priority, title, description = '', scope, summary, plan, refs, status = 'refinement', parentId } = input;
    const trimmedTitle = String(title ?? '').trim();
    if (!trimmedTitle) throw new Error('Validation failed: title must not be empty or whitespace-only.');

    return db.transaction(() => {
      assertParent(type, parentId ?? null);
      const info = stmtInsertTask.run(
        trimmedTitle,
        type,
        status,
        priority,
        scope?.trim() || null,
        summary?.trim() || null,
        description.trim(),
        plan?.trim() || null,
        parentId ?? null
      );
      const newId = Number(info.lastInsertRowid);
      if (parentId != null) syncEpicStatus(parentId, status);

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
        title: patch.title !== undefined ? patch.title.trim() : existing.title,
        type: patch.type ?? existing.type,
        priority: patch.priority ?? existing.priority,
        scope: patch.scope === null
          ? null
          : patch.scope !== undefined ? (patch.scope.trim() || null) : existing.scope,
        summary: patch.summary === null
          ? null
          : patch.summary !== undefined ? (patch.summary.trim() || null) : existing.summary,
        description: patch.description !== undefined ? patch.description.trim() : existing.description,
        plan: patch.plan === null
          ? null
          : patch.plan !== undefined ? (patch.plan.trim() || null) : existing.plan,
        parentId: patch.parentId !== undefined ? patch.parentId : existing.parent_id,
      };

      // Only re-validate when the link can change, so plan/description edits never trip it.
      if (patch.type !== undefined || patch.parentId !== undefined) assertParent(next.type, next.parentId, id, existing.type);
      stmtUpdateTask.run(next.title, next.type, next.priority, next.scope, next.summary, next.description, next.plan, next.parentId, id);
      if (next.parentId !== existing.parent_id) {
        if (existing.parent_id !== null) syncEpicStatus(existing.parent_id, null);
        if (next.parentId !== null) syncEpicStatus(next.parentId, existing.status);
      }

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
      const existing = stmtSelectTask.get(id) as TaskRow | undefined;
      if (!existing) return false;
      stmtSetTaskStatus.run(status, id);
      if (existing.parent_id !== null && existing.status !== status) syncEpicStatus(existing.parent_id, status);
      return true;
    })();
  }

  // childStatus null = a child left the epic (moved away or deleted).
  function syncEpicStatus(epicId: number, childStatus: TaskStatus | null): void {
    const epic = stmtSelectTask.get(epicId) as TaskRow | undefined;
    if (!epic || epic.type !== 'epic') return;
    let next: TaskStatus | null = null;
    if (childStatus === 'in_progress') next = 'in_progress';
    else if (childStatus === 'done' || childStatus === null) {
      const children = stmtChildrenOf.all(epicId) as EpicChild[];
      if (children.length > 0 && children.every((c) => c.status === 'done')) next = 'done';
    }
    if (next && epic.status !== next) stmtSetTaskStatus.run(next, epicId);
  }

  function deleteTask(id: number): boolean {
    return db.transaction(() => {
      const existing = stmtSelectTask.get(id) as TaskRow | undefined;
      if (!existing) return false;
      // FK ON DELETE CASCADE handles refs in both directions and notes;
      // ON DELETE SET NULL detaches an epic's children.
      stmtDeleteTask.run(id);
      if (existing.parent_id !== null) syncEpicStatus(existing.parent_id, null);
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
    const tasks = attachRefs(rows);
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
    const tasks = attachRefs(rows);
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
    const tasks = attachRefs(rows);
    return sortByPriority(tasks);
  }

  function getNext(type?: TaskType): Task | null {
    let rows: TaskRow[];
    if (type) {
      rows = db.prepare(`
        SELECT * FROM tasks
        WHERE status IN ('todo', 'in_progress', 'refinement', 'plan')
        AND type = ? AND type != 'epic'
      `).all(type) as TaskRow[];
    } else {
      rows = db.prepare(`
        SELECT * FROM tasks
        WHERE status IN ('todo', 'in_progress', 'refinement', 'plan')
        AND type != 'epic'
      `).all() as TaskRow[];
    }
    const tasks = attachRefs(rows);
    const sorted = sortForNext(tasks);
    return sorted[0] ?? null;
  }

  function getOverview(status?: StatusFilter): OverviewEntry[] {
    const resolved = resolveStatusFilter(status);

    if (!Array.isArray(resolved)) {
      // Specific status requested — return a simple count per type so no zero-buckets appear.
      const rows = db.prepare(`
        SELECT type, COUNT(*) AS count
        FROM tasks
        WHERE status = ?
        GROUP BY type
      `).all(resolved) as { type: TaskType; count: number }[];
      return ALL_TYPES
        .map((type): OverviewEntry | null => {
          const r = rows.find((x) => x.type === type);
          return r ? { type, count: r.count, status: resolved } : null;
        })
        .filter((o): o is OverviewEntry => o !== null)
        .sort((a, b) => ('count' in b ? b.count : 0) - ('count' in a ? a.count : 0));
    }

    const placeholders = resolved.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT type,
             SUM(CASE WHEN status = 'refinement' THEN 1 ELSE 0 END) AS refinement,
             SUM(CASE WHEN status = 'plan' THEN 1 ELSE 0 END) AS plan,
             SUM(CASE WHEN status IN ('todo', 'in_progress') THEN 1 ELSE 0 END) AS open,
             SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
      FROM tasks
      WHERE status IN (${placeholders})
      GROUP BY type
    `).all(...resolved) as { type: TaskType; refinement: number; plan: number; open: number; done: number }[];
    return ALL_TYPES
      .map((type): OverviewEntry | null => {
        const r = rows.find((x) => x.type === type);
        return r ? { type, refinement: r.refinement, plan: r.plan, open: r.open, done: r.done } : null;
      })
      .filter((o): o is OverviewEntry => o !== null && ('refinement' in o ? o.refinement + o.plan + o.open + o.done > 0 : true))
      .sort((a, b) => ('open' in b ? b.open : 0) - ('open' in a ? a.open : 0));
  }

  // Injection lives here, not in readTask: update() echoes readTask and must stay slim.
  function getById(id: number): Task | null {
    const task = readTask(id);
    if (!task) return null;
    if (task.parentId !== undefined) {
      const epic = stmtSelectTask.get(task.parentId) as TaskRow | undefined;
      if (epic) {
        const ctx: EpicContext = { id: epic.id, title: epic.title, status: epic.status, description: epic.description ?? '' };
        if (epic.summary) ctx.summary = epic.summary;
        const notes = stmtNotesFor.all(epic.id) as Note[];
        if (notes.length) ctx.notes = notes;
        task.epic = ctx;
      }
    }
    if (task.type === 'epic') task.children = stmtChildrenOf.all(id) as EpicChild[];
    return task;
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
    const tasks = attachRefs(rows);
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
    const outboundIds = (task.refs ?? []).map((r) => r.id);

    // Inbound = other tasks pointing at this task.
    const inboundRefs = db.prepare(
      'SELECT from_id, relation FROM refs WHERE to_id = ? AND from_id != ?'
    ).all(id, id) as { from_id: number; relation: string }[];
    const inboundIds = inboundRefs.map((r) => r.from_id);

    // Bulk-load all related tasks in one shot, then join.
    const relatedIds = [...new Set([...outboundIds, ...inboundIds])];
    let relatedTasks: Task[] = [];
    if (relatedIds.length > 0) {
      const placeholders = relatedIds.map(() => '?').join(', ');
      const rows = db.prepare(
        `SELECT * FROM tasks WHERE id IN (${placeholders})`
      ).all(...relatedIds) as TaskRow[];
      relatedTasks = attachRefs(rows);
    }
    const taskById = new Map(relatedTasks.map((t) => [t.id, t]));

    const outbound = (task.refs ?? []).flatMap((ref) => {
      const t = taskById.get(ref.id);
      return t && matchesStatus(t) ? [{ ...t, refRelation: ref.relation as string }] : [];
    });
    const inbound = inboundRefs.flatMap((r) => {
      const t = taskById.get(r.from_id);
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

  function validNoteBody(body: string): string {
    const trimmed = String(body ?? '').trim();
    if (!trimmed) throw new Error('Validation failed: note body must not be empty or whitespace-only.');
    return trimmed;
  }

  function addNote(taskId: number, body: string): Note | null {
    const trimmed = validNoteBody(body);
    return db.transaction(() => {
      if (!stmtSelectTask.get(taskId)) return null;
      const info = stmtInsertNote.run(taskId, trimmed);
      stmtTouchTask.run(taskId);
      return stmtSelectNote.get(Number(info.lastInsertRowid)) as Note;
    })();
  }

  function updateNote(noteId: number, body: string): Note | null {
    const trimmed = validNoteBody(body);
    return db.transaction(() => {
      const existing = stmtSelectNote.get(noteId) as Note | undefined;
      if (!existing) return null;
      stmtUpdateNote.run(trimmed, noteId);
      stmtTouchTask.run(existing.task_id);
      return stmtSelectNote.get(noteId) as Note;
    })();
  }

  function deleteNote(noteId: number): boolean {
    return db.transaction(() => {
      const existing = stmtSelectNote.get(noteId) as Note | undefined;
      if (!existing) return false;
      stmtDeleteNote.run(noteId);
      stmtTouchTask.run(existing.task_id);
      return true;
    })();
  }

  function close(): void {
    db.close();
  }

  return {
    db, // exposed for advanced cases; avoid using directly — prefer dataVersion() for polling
    dataVersion: () => db.pragma('data_version', { simple: true }) as number,
    load,
    loadWithNotes,
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
    addNote,
    updateNote,
    deleteNote,
    close,
  };
}


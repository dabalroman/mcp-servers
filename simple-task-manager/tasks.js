// SQLite-backed task store. Replaces the previous markdown/DSL parser.
// Schema lives in schema_migrations; see CURRENT_USER_VERSION below.
import Database from 'better-sqlite3';

export const CURRENT_USER_VERSION = 3;

const PRIORITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };
const STATUS_ORDER = { in_progress: 3, refinement: 2, todo: 1, done: 0 };
const ALL_TYPES = ['bug', 'feature', 'idea', 'tool', 'other'];

export const RELATIONS = [
  'blocks', 'is blocked by',
  'depends on', 'is depended on by',
  'causes', 'is caused by',
  'tests', 'is tested by',
  'relates to',
];
const INVERSE = {
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

// ── Migrations ────────────────────────────────────────────────────────────────
// Each migration: { version, name, up(db) }. `up` runs inside a transaction.
const MIGRATIONS = [
  {
    version: 1,
    name: 'initial-schema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id          INTEGER PRIMARY KEY,
          title       TEXT NOT NULL,
          type        TEXT NOT NULL CHECK (type IN ('bug','feature','idea','tool','other')),
          status      TEXT NOT NULL CHECK (status IN ('refinement','todo','in_progress','done')),
          priority    TEXT NOT NULL CHECK (priority IN ('low','medium','high','critical')),
          scope       TEXT,
          summary     TEXT,
          description TEXT,
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_scope  ON tasks(scope);
        CREATE INDEX IF NOT EXISTS idx_tasks_type   ON tasks(type);

        CREATE TABLE IF NOT EXISTS refs (
          from_id        INTEGER NOT NULL,
          to_id          INTEGER NOT NULL,
          relation       TEXT NOT NULL,
          non_canonical  INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (from_id, to_id, relation),
          FOREIGN KEY (from_id) REFERENCES tasks(id) ON DELETE CASCADE,
          FOREIGN KEY (to_id)   REFERENCES tasks(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_refs_to ON refs(to_id);

        INSERT OR IGNORE INTO meta (key, value) VALUES ('counter', '0');
      `);
    },
  },
  {
    version: 2,
    name: 'normalize-literal-newlines',
    up(db) {
      db.exec(`
        UPDATE tasks SET description = replace(description, '\\n', char(10))
        WHERE description LIKE '%\\n%';
        UPDATE tasks SET title = replace(title, '\\n', char(10))
        WHERE title LIKE '%\\n%';
      `);
    },
  },
  {
    version: 3,
    name: 'refs_pk_simplify',
    up(db) {
      db.exec(`
        CREATE TABLE refs_new (
          from_id       INTEGER NOT NULL,
          to_id         INTEGER NOT NULL,
          relation      TEXT NOT NULL,
          non_canonical INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (from_id, to_id),
          FOREIGN KEY (from_id) REFERENCES tasks(id) ON DELETE CASCADE,
          FOREIGN KEY (to_id)   REFERENCES tasks(id) ON DELETE CASCADE
        );
        INSERT OR REPLACE INTO refs_new SELECT from_id, to_id, relation, non_canonical FROM refs;
        DROP TABLE refs;
        ALTER TABLE refs_new RENAME TO refs;
        CREATE INDEX IF NOT EXISTS idx_refs_to ON refs(to_id);
      `);
    },
  },
];

function runMigrations(db, dbPath) {
  const currentVersion = db.pragma('user_version', { simple: true });
  if (currentVersion > CURRENT_USER_VERSION) {
    throw new Error(
      `Schema version mismatch on "${dbPath}": db is at user_version=${currentVersion}, ` +
      `code expects ${CURRENT_USER_VERSION}. The database was created by a newer version of this code. ` +
      `Update the package or restore from backup.`
    );
  }

  // The schema_migrations table predates the per-migration `up` so it's created here, not in a migration.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );

  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (version, name) VALUES (?, ?)'
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      migration.up(db);
      insertMigration.run(migration.version, migration.name);
    })();
  }

  db.pragma(`user_version = ${CURRENT_USER_VERSION}`);
}

// ── Row mapping ───────────────────────────────────────────────────────────────
function rowToTask(row, refs) {
  const t = {
    id: row.id,
    title: row.title,
    type: row.type,
    status: row.status,
    priority: row.priority,
  };
  if (row.scope) t.scope = row.scope;
  if (row.summary) t.summary = row.summary;
  t.description = row.description ?? '';
  if (refs && refs.length) t.refs = refs;
  return t;
}

function refRowToObj(r) {
  const out = { id: r.to_id, relation: r.relation };
  if (r.non_canonical) out.nonCanonical = true;
  return out;
}

// Defensive guard: Claude sometimes emits literal \n (0x5C 0x6E) as text tokens
// in MCP tool call arguments instead of real newline bytes (0x0A).
const normalizeNewlines = (s) => (typeof s === 'string' ? s.replace(/\\n/g, '\n') : s);

// ── Helpers (pure) ────────────────────────────────────────────────────────────
export function sortByPriority(tasks) {
  return [...tasks].sort((a, b) => {
    const pd = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
    return pd !== 0 ? pd : b.id - a.id;
  });
}

export function sortForNext(tasks) {
  return [...tasks].sort((a, b) => {
    const sd = STATUS_ORDER[b.status] - STATUS_ORDER[a.status];
    if (sd !== 0) return sd;
    const pd = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
    return pd !== 0 ? pd : b.id - a.id;
  });
}

// ── Store factory ─────────────────────────────────────────────────────────────
export function createStore(dbPath) {
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

  runMigrations(db, dbPath);

  // Prepared statements
  const stmtGetCounter      = db.prepare("SELECT value FROM meta WHERE key = 'counter'");
  const stmtSetCounter      = db.prepare("UPDATE meta SET value = ? WHERE key = 'counter'");
  const stmtInsertTask      = db.prepare(
    'INSERT INTO tasks (id, title, type, status, priority, scope, summary, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const stmtUpdateTaskTouch = db.prepare(`UPDATE tasks SET updated_at = datetime('now') WHERE id = ?`);
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
  const stmtDeleteOneRef    = db.prepare('DELETE FROM refs WHERE from_id = ? AND to_id = ? AND relation = ?');
  const stmtUpdateRefRelation = db.prepare(
    'UPDATE refs SET relation = ? WHERE from_id = ? AND to_id = ?'
  );
  const stmtDeleteMirror    = db.prepare('DELETE FROM refs WHERE from_id = ? AND to_id = ? AND relation = ?');
  const stmtUpdateTask      = db.prepare(`
    UPDATE tasks
    SET title = ?, type = ?, priority = ?, scope = ?, summary = ?, description = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  const stmtSetTaskStatus   = db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`);

  function getCounter() {
    return parseInt(stmtGetCounter.get().value, 10);
  }
  function setCounter(n) { stmtSetCounter.run(String(n)); }

  function readRefsFor(id) {
    return stmtRefsFrom.all(id).map(refRowToObj);
  }

  function readTask(id) {
    const row = stmtSelectTask.get(id);
    if (!row) return null;
    return rowToTask(row, readRefsFor(id));
  }

  function readAllTasks() {
    const rows = stmtSelectAllTasks.all();
    if (rows.length === 0) return [];
    const refsByFrom = new Map();
    for (const r of stmtRefsAll.all()) {
      const arr = refsByFrom.get(r.from_id) ?? [];
      arr.push(refRowToObj(r));
      refsByFrom.set(r.from_id, arr);
    }
    return rows.map((row) => rowToTask(row, refsByFrom.get(row.id) ?? []));
  }

  function getValidIds() {
    return new Set(stmtSelectAllIds.all().map((r) => r.id));
  }

  // Apply refs change for a single source task. Mirrors canonical refs and removes
  // mirrors when refs are removed/changed. Mutates the refs table; callers wrap
  // in a transaction.
  function applyRefsImpl(sourceId, oldRefs, nextRefs) {
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
  function load() {
    const all = readAllTasks();
    const counter = getCounter();
    const active = all.filter((t) => t.status !== 'done');
    const done = all.filter((t) => t.status === 'done');
    return { counter, active, done };
  }

  function add({ type, priority, title, description = '', scope, summary, refs, status = 'refinement' }) {
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
        normalizeNewlines(description.trim())
      );
      setCounter(newId);

      if (refs?.length) {
        applyRefsImpl(newId, [], refs);
      }
      return { id: newId };
    })();
  }

  function update(id, patch) {
    return db.transaction(() => {
      const existing = stmtSelectTask.get(id);
      if (!existing) return null;

      const next = {
        title: patch.title !== undefined ? normalizeNewlines(patch.title.trim()) : existing.title,
        type: patch.type ?? existing.type,
        status: existing.status,
        priority: patch.priority ?? existing.priority,
        scope: patch.scope === null
          ? null
          : patch.scope !== undefined ? (patch.scope.trim() || null) : existing.scope,
        summary: patch.summary === null
          ? null
          : patch.summary !== undefined ? (patch.summary.trim() || null) : existing.summary,
        description: patch.description !== undefined ? normalizeNewlines(patch.description.trim()) : existing.description,
      };

      stmtUpdateTask.run(next.title, next.type, next.priority, next.scope, next.summary, next.description, id);

      if (patch.refs !== undefined) {
        const oldRefs = readRefsFor(id);
        const nextRefs = patch.refs === null || patch.refs.length === 0 ? [] : patch.refs;
        applyRefsImpl(id, oldRefs, nextRefs);
      }

      return { task: readTask(id) };
    })();
  }

  function setStatus(id, status) {
    return db.transaction(() => {
      const existing = stmtSelectTask.get(id);
      if (!existing) return false;
      stmtSetTaskStatus.run(status, id);
      return true;
    })();
  }

  function deleteTask(id) {
    return db.transaction(() => {
      const existing = stmtSelectTask.get(id);
      if (!existing) return false;
      // FK ON DELETE CASCADE handles refs in both directions.
      stmtDeleteTask.run(id);
      return true;
    })();
  }

  function getByStatus(status, scope) {
    let rows;
    if (scope !== undefined) {
      rows = db.prepare('SELECT * FROM tasks WHERE status = ? AND scope = ?').all(status, scope);
    } else {
      rows = db.prepare('SELECT * FROM tasks WHERE status = ?').all(status);
    }
    const tasks = rows.map((row) => rowToTask(row, readRefsFor(row.id)));
    return sortByPriority(tasks);
  }

  function getByScope(scope) {
    const rows = db.prepare('SELECT * FROM tasks WHERE scope = ?').all(scope);
    const tasks = rows.map((row) => rowToTask(row, readRefsFor(row.id)));
    return sortByPriority(tasks);
  }

  function getByType(type) {
    const rows = db.prepare('SELECT * FROM tasks WHERE type = ?').all(type);
    const tasks = rows.map((row) => rowToTask(row, readRefsFor(row.id)));
    return sortByPriority(tasks);
  }

  function getNext(type) {
    let rows;
    if (type) {
      rows = db.prepare(`
        SELECT * FROM tasks
        WHERE status IN ('todo', 'in_progress', 'refinement')
        AND type = ?
      `).all(type);
    } else {
      rows = db.prepare(`
        SELECT * FROM tasks
        WHERE status IN ('todo', 'in_progress', 'refinement')
      `).all();
    }
    const tasks = rows.map((row) => rowToTask(row, readRefsFor(row.id)));
    const sorted = sortForNext(tasks);
    return sorted[0] ?? null;
  }

  function getOverview() {
    const rows = db.prepare(`
      SELECT type,
             SUM(CASE WHEN status = 'refinement' THEN 1 ELSE 0 END) AS refinement,
             SUM(CASE WHEN status IN ('todo', 'in_progress') THEN 1 ELSE 0 END) AS open,
             SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
      FROM tasks
      GROUP BY type
    `).all();
    return ALL_TYPES
      .map((type) => {
        const r = rows.find((x) => x.type === type);
        return r ? { type, refinement: r.refinement, open: r.open, done: r.done } : null;
      })
      .filter((o) => o !== null && (o.refinement + o.open + o.done > 0))
      .sort((a, b) => b.open - a.open);
  }

  function getById(id) {
    return readTask(id);
  }

  function getRelated(id) {
    const task = readTask(id);
    if (!task) return null;

    // Outbound = task's own refs (already on task.refs after readTask).
    const outbound = (task.refs ?? []).flatMap((ref) => {
      const t = readTask(ref.id);
      return t ? [{ ...t, refRelation: ref.relation }] : [];
    });

    // Inbound = other tasks pointing at this task.
    const inboundRefs = db.prepare(
      'SELECT from_id, relation FROM refs WHERE to_id = ? AND from_id != ?'
    ).all(id, id);
    const inbound = inboundRefs.flatMap((r) => {
      const t = readTask(r.from_id);
      return t ? [{ ...t, refRelation: r.relation }] : [];
    });

    return { task, outbound, inbound };
  }

  function getScopes() {
    const rows = db.prepare(`
      SELECT scope,
             COUNT(*) AS total,
             SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END) AS open
      FROM tasks
      WHERE scope IS NOT NULL
      GROUP BY scope
    `).all();
    return rows
      .map((r) => ({ scope: r.scope, total: r.total, open: r.open }))
      .sort((a, b) => {
        if (b.open !== a.open) return b.open - a.open;
        if (b.total !== a.total) return b.total - a.total;
        return a.scope.localeCompare(b.scope);
      });
  }

  function close() {
    db.close();
  }

  return {
    db, // exposed for advanced cases; avoid using directly — prefer dataVersion() for polling
    dataVersion: () => db.pragma('data_version', { simple: true }),
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
    close,
  };
}

// ── Pure helpers exported for tests / migrate.js ──────────────────────────────
// Mutates allTasks in place — preserved for backward-compat with random-tools' vendor mirror.
export function applyRefs(allTasks, sourceId, oldRefs, nextRefs) {
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
      const inverse = INVERSE[ref.relation] ?? ref.relation;
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
      const inverse = INVERSE[ref.relation] ?? ref.relation;
      task.refs = task.refs.map((r) => (r.id === sourceId ? { ...r, relation: inverse } : r));
    }
  }
  return allTasks;
}

export function cascadeDelete(allTasks, deletedId) {
  for (const task of allTasks) {
    if (!task.refs) continue;
    task.refs = task.refs.filter((r) => r.id !== deletedId);
    if (task.refs.length === 0) task.refs = undefined;
  }
  return allTasks;
}

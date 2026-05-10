import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve } from 'node:path';
import { VERSION } from './version.js';
import { createStore, RELATIONS } from './tasks.js';

if (process.env.TASKS_FILE || process.env.TASKS_DONE_FILE) {
  process.stderr.write(
    '[simple-task-manager] WARNING: TASKS_FILE / TASKS_DONE_FILE are no longer used. ' +
    'Set TASKS_DB to the path of the SQLite database (e.g. /abs/path/tasks.db). ' +
    'Run `node migrate.js <legacy-tasks.md> <legacy-tasks_done.md> <output.db>` to migrate.\n'
  );
}

if (!process.env.TASKS_DB) {
  throw new Error(
    'TASKS_DB env var is required (path to the SQLite tasks database). ' +
    'See README for migration from the legacy markdown format.'
  );
}
const TASKS_DB = resolve(process.env.TASKS_DB);
const store = createStore(TASKS_DB);

const INSTRUCTIONS = `
You are connected to simple-task-manager — a persistent task tracker that survives session restarts and context compaction.
Tasks live in a single SQLite database (env var \`TASKS_DB\`); they used to live in TASKS.md / TASKS_DONE.md before the SQLite migration.

## Critical scheduling rules
- When the user says "schedule X", "TODO X", "add to the list", "FEATURE X", "BUG X", "IDEA X" — call add() and STOP. Do NOT also implement it.
- If the user mentions a bug or feature that is outside the current task's scope, ask whether to schedule it before continuing.
- Suggest next work via getNext (or getAll for the full picture) whenever a task finishes or a session ends.

## Default status for NEW tasks — ALWAYS 'refinement'
This is a hard rule; do not bypass it for "obvious" or "small" tasks. add() defaults status to 'refinement' for a reason.
You may pass status: 'todo' ONLY when one of these is true:
  (a) The user explicitly tells you to skip refinement ("schedule as todo", "ready to implement", "no refinement needed", or similar).
  (b) The current conversation already performed refinement on this exact task — i.e. you and the user discussed the scope, acceptance criteria, and constraints just now, and the description you are about to write captures that discussion fully.
If neither (a) nor (b) holds, omit the status field (or pass 'refinement') and let the next session do PM-style clarification. When in doubt, choose 'refinement' — it costs nothing and prevents premature implementation.

## Task lifecycle — always follow this order
1. New tasks start in 'refinement'. When getNext returns a refinement task, act as project manager: ask the user clarifying questions, enrich the description via update(), then call setStatus(id, 'todo') to promote it. Do not start implementing a refinement task.
2. Call setStatus(id, 'in_progress') BEFORE starting any task in 'todo'.
3. Call setStatus(id, 'done') AFTER the commit is made AND the user confirms. Never before.
4. Use delete() only when the user explicitly asks to cancel or remove a task — not for completed work.

## Refinement — acting as project manager
When a task is in 'refinement', your job is to surface it and ask targeted questions to clarify scope, acceptance criteria, edge cases, and technical constraints. Use update() to record the answers in the task description. Only promote to 'todo' (via setStatus) once the description is specific enough that an implementer could work from it without guessing. Ask for user confirmation before promoting.

## Prioritization order for getNext
bug > tool > feature > idea > other. Within each type: highest priority first, newest id first (FILO).

## User prefixes
- BUG      → type: bug,     high priority by default
- TODO / SCHEDULE → type: tool or feature, near-term
- FEATURE  → type: feature  (requires a planning session before implementation — write a plan doc, no code yet)
- IDEA     → type: idea     (exploratory; refine into a feature before implementing)

## Development pipeline (mandatory, never skip steps)
1. Schedule  — out-of-scope requests go to add(), do not implement inline. New tasks default to 'refinement'.
2. Refine    — for refinement tasks: ask PM questions, update() description, setStatus('todo') when ready
3. Plan      — for features: write a plan document, no code changes in this step
4. Implement — read relevant files before editing; no speculative changes beyond the task
5. Build     — must succeed with zero errors
6. Test      — verify end-to-end; wait for user confirmation before proceeding
7. Commit    — stage files, write a clear commit message
8. Next      — suggest what to do next via getNext or getAll

## Refs — structured relations with automatic mirroring
When you add a ref on task A pointing to task B, the server automatically writes the inverse on task B.
You never need to add both sides manually.

Relation vocabulary (pick the one that describes A → B):
- blocks / is blocked by
- depends on / is depended on by
- causes / is caused by
- tests / is tested by
- relates to (symmetric — same relation appears on both sides)

Default relation: "relates to".

## Scope — tagging tasks to an area
Set scope on tasks belonging to a specific tool or area (e.g. "auth", "dashboard"). Query with getByScope (exact, case-sensitive) or getByStatus with a scope filter. Use getScopes to list all valid scope values.

## Auto-knowledge capture
After every task is closed (setStatus → done), curate the relevant CLAUDE.md file(s) before moving on:
- **Add**: non-obvious decisions and their rationale, gotchas and env constraints, new conventions or patterns, significant file-layout or architecture changes.
- **Remove / update**: any existing entries now stale, contradicted, or superseded by this task's changes. Stale knowledge is worse than missing knowledge.
- **Target**: choose the closest appropriate file — project-root CLAUDE.md, per-tool CLAUDE.md inside the changed directory, or another file Claude already reads. Prefer proximity to the changed code; no single file is mandatory.
- **Quality**: read the target file first and dedup — only add what is genuinely new. Keep entries terse; CLAUDE.md is dense reference material. Format to match the file's existing style.
- **Skip**: if nothing non-obvious was learned, skip the pass entirely — no forced entries.
`.trim();

const server = new McpServer(
  { name: 'simple-task-manager', version: VERSION },
  { instructions: INSTRUCTIONS }
);

const refsSchema = z.array(z.object({
  id: z.number().int().positive(),
  relation: z.enum(/** @type {[string, ...string[]]} */(RELATIONS)).default('relates to'),
})).optional();

const text = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });
const errorText = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }], isError: true });

function allIdsSorted() {
  const { active, done } = store.load();
  return [...active.map((t) => t.id), ...done.map((t) => t.id)].sort((a, b) => a - b);
}

// ── add ────────────────────────────────────────────────────────────────────────
server.tool(
  'add',
  'Schedule a new task — call this whenever the user reports a bug, requests a feature, shares an idea, or says "schedule" / "TODO" / "add to the list". Do NOT implement the task inline; add it and stop. New tasks ALWAYS default to status "refinement"; only pass status: "todo" when (a) the user explicitly asks to skip refinement, OR (b) the current conversation already refined this exact task with the user. When in doubt, omit status and let the next session run PM-style clarification. Returns { id } of the newly created task. Refs are auto-mirrored on the other side; no need for a separate update call.',
  {
    type: z.enum(['bug', 'feature', 'idea', 'tool', 'other'])
      .describe('bug = defect to fix (highest priority class); feature = planned work that requires a /plan session before implementation; idea = exploratory thought, needs refinement before it becomes a feature; tool = developer-tooling improvement; other = anything that does not fit the above'),
    priority: z.enum(['low', 'medium', 'high', 'critical'])
      .describe('critical = blocking or data-loss risk, fix immediately; high = important, tackle soon; medium = normal backlog; low = nice-to-have'),
    title: z.string().min(1, 'Title must not be empty')
      .describe('Short, action-oriented title — start with a verb (e.g. "Fix undo animation glitch on session delete", "Add dark-mode toggle to settings")'),
    description: z.string()
      .describe('Full context the implementer will need: what is broken or needed, reproduction steps or acceptance criteria, relevant file paths, technical constraints. Be thorough — this is what the next session will read.'),
    scope: z.string().optional()
      .describe('Optional tool or area this task belongs to (e.g. "svg-path-joiner", "eink-frame", "task-manager"). Omit for project-wide tasks. Use getByScope to filter tasks by this value later.'),
    refs: refsSchema
      .describe('Optional related-task references — use when this task depends on, blocks, or is otherwise connected to existing tasks. Each entry: { id: number, relation?: string }. Relation must be one of the canonical values; default "relates to". The server automatically writes the inverse on the referenced task — you only need to specify one side.'),
    status: z.enum(['refinement', 'todo']).default('refinement')
      .describe('Initial status. ALWAYS leave as default "refinement" unless one of these holds: (a) the user explicitly told you to skip refinement / mark as todo, or (b) you just refined this exact task with the user in the current conversation. Otherwise pass "refinement" (or omit the field). Choosing "todo" without one of those conditions is a rule violation — when in doubt, pick "refinement".'),
  },
  async ({ type, priority, title, description, scope, refs, status }) => {
    try {
      const { id } = store.add({ type, priority, title, description, scope, refs, status });
      return text({ id });
    } catch (err) {
      return errorText({ error: err.message });
    }
  }
);

// ── getByType ──────────────────────────────────────────────────────────────────
server.tool(
  'getByType',
  'Get all tasks of a specific type across all statuses — use for "show me all bugs", "list features", "what ideas do we have?". Includes done tasks. Sorted by priority desc then id desc. Prefer getNext when the user just wants the single recommended next task; prefer getAll for the full open backlog.',
  { type: z.enum(['bug', 'feature', 'idea', 'tool', 'other']).describe('Task type to filter: bug | feature | idea | tool | other') },
  async ({ type }) => text({ tasks: store.getByType(type) })
);

// ── getOverview ────────────────────────────────────────────────────────────────
server.tool(
  'getOverview',
  'Get a count summary per type: refinement, open (todo + in_progress), and done counts. Use for dashboard questions like "how many tasks are there?" or "give me a backlog summary". Returns only types that have at least one task, sorted by open count desc. Do NOT use this to answer "what\'s next?" — use getNext for that.',
  {},
  async () => text({ overview: store.getOverview() })
);

// ── getNext ────────────────────────────────────────────────────────────────────
server.tool(
  'getNext',
  'Get the single next actionable task — use for "what should I do next?", "what\'s next?", or any recommendation request. Sort order: in_progress first (resume interrupted work), then refinement (needs PM clarification), then todo, then highest priority, then newest id (FILO). Considers refinement, todo, and in_progress tasks. Optional type filter narrows to one category. When no filter is given, apply the project prioritization order: bug > tool > feature > idea > other. IMPORTANT: if the returned task has status "refinement", do NOT start implementing — instead ask the user clarifying questions to refine the description, then promote to "todo" via setStatus.',
  {
    type: z.enum(['bug', 'feature', 'idea', 'tool', 'other']).optional()
      .describe('Narrow to one type (optional). Omit to recommend across all types using the bug > tool > feature > idea > other order.')
  },
  async ({ type }) => text({ task: store.getNext(type) })
);

// ── getAll ─────────────────────────────────────────────────────────────────────
server.tool(
  'getAll',
  'Get every not-done task (refinement + todo + in_progress) grouped by type — use for "show me everything", "list all tasks", "full backlog". Groups appear in type order: bug, feature, idea, tool, other. Each group sorted by priority desc then id desc. Does NOT include done tasks — use getByType or getById to look up archived work. Prefer getNext for a single recommendation; prefer getByType when the user asks about one specific type.',
  {},
  async () => {
    const allTypes = ['bug', 'feature', 'idea', 'tool', 'other'];
    const grouped = {};
    for (const type of allTypes) {
      const ofType = store.getByType(type).filter((t) => t.status !== 'done');
      if (ofType.length > 0) grouped[type] = ofType;
    }
    return text({ tasks: grouped });
  }
);

// ── getById ────────────────────────────────────────────────────────────────────
server.tool(
  'getById',
  'Get a single task by its numeric ID — use when the user asks about a specific task by number (e.g. "show me #42", "what is task 37?"). Returns the full task object including scope, refs, and description, or an error listing valid IDs if not found.',
  { id: z.coerce.number().int().positive().describe('The numeric task ID to look up') },
  async ({ id }) => {
    const task = store.getById(id);
    if (!task) {
      return errorText({ error: `Task #${id} not found. Valid IDs: ${allIdsSorted().join(', ') || 'none'}` });
    }
    return text({ task });
  }
);

// ── setStatus ──────────────────────────────────────────────────────────────────
server.tool(
  'setStatus',
  'Update a task\'s status. Lifecycle rules: always call setStatus(in_progress) before starting work on a task; always call setStatus(done) after the commit is made and the user confirms. Returns { success: true } or { success: false, error }.',
  {
    id: z.coerce.number().int().positive().describe('Task ID — get it from getNext, getAll, getByType, or getById'),
    status: z.enum(['refinement', 'todo', 'in_progress', 'done']).describe('refinement = needs PM clarification before work starts; todo = ready to implement; in_progress = actively being worked on (set this before beginning); done = completed and committed (set this after user confirms the commit)')
  },
  async ({ id, status }) => {
    const ok = store.setStatus(id, status);
    if (!ok) {
      return text({ success: false, error: `Task #${id} not found. Valid IDs are: ${allIdsSorted().join(', ') || 'none'}` });
    }
    const result = { success: true };
    if (status === 'done') {
      result.knowledgeReminder = 'Task closed. Before moving on: (1) identify non-obvious decisions, gotchas, conventions, or architecture changes from this task; (2) update the closest relevant CLAUDE.md with anything genuinely new — keep entries terse and deduped; (3) prune or correct any entries now stale or contradicted. Skip if nothing worth capturing.';
    }
    return text(result);
  }
);

// ── update ────────────────────────────────────────────────────────────────────
server.tool(
  'update',
  'Patch any fields of an existing task in place — use when the user asks to edit, rename, reprioritize, retype, rescope, or update the refs/description of a task. Only the fields you provide are changed; omitted fields keep their current values. Returns { success: true, task } with the full updated task, or { success: false, error }.',
  {
    id: z.coerce.number().int().positive().describe('Task ID to update — get it from getNext, getAll, getById, etc.'),
    title: z.string().min(1).optional().describe('New title (replaces current). Start with a verb.'),
    description: z.string().optional().describe('New description (replaces current). Include full context: what, why, acceptance criteria, file paths.'),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('New priority: critical = blocking; high = important soon; medium = normal; low = nice-to-have'),
    type: z.enum(['bug', 'feature', 'idea', 'tool', 'other']).optional().describe('New type — use to reclassify a task (e.g. idea → feature after refinement)'),
    scope: z.string().nullable().optional().describe('New scope tag (e.g. "eink-frame"), or null to clear the scope entirely'),
    refs: refsSchema.nullable()
      .describe('Full replacement list of related-task references, or null / empty array to clear all refs. Each entry: { id, relation? } where relation is one of the canonical values. Defaults to "relates to". The server automatically updates the inverse on each referenced task — only specify one side. This replaces the existing refs list entirely — include all refs you want to keep.'),
  },
  async ({ id, ...patch }) => {
    const result = store.update(id, patch);
    if (!result) {
      return text({ success: false, error: `Task #${id} not found. Valid IDs are: ${allIdsSorted().join(', ') || 'none'}` });
    }
    return text({ success: true, task: result.task });
  }
);

// ── getByScope ────────────────────────────────────────────────────────────────
server.tool(
  'getByScope',
  'Get all tasks tagged with a specific scope — use when the user asks "what tasks are there for svg-path-joiner?" or "show me everything related to eink-frame". Includes all statuses (todo, in_progress, done). Sorted by priority desc then id desc. Scope values are set via add or update. Empty results may indicate a wrong/typo\'d scope; use getScopes to discover valid values.',
  { scope: z.string().describe('Exact scope value to filter by (e.g. "svg-path-joiner"). Must match exactly — scope is case-sensitive.') },
  async ({ scope }) => text({ scope, tasks: store.getByScope(scope) })
);

// ── getRelated ────────────────────────────────────────────────────────────────
server.tool(
  'getRelated',
  'Get tasks related to a given task — returns the task itself, outbound (tasks that #X references, decorated with refRelation), and inbound (tasks that reference #X). Searches all tasks regardless of status.',
  { id: z.coerce.number().int().positive().describe('Task ID to find related tasks for') },
  async ({ id }) => {
    const result = store.getRelated(id);
    if (!result) {
      return errorText({ error: `Task #${id} not found. Valid IDs: ${allIdsSorted().join(', ') || 'none'}` });
    }
    return text(result);
  }
);

// ── getByStatus ───────────────────────────────────────────────────────────────
server.tool(
  'getByStatus',
  'Get all tasks with a specific status — use for "show me everything in refinement", "what\'s in progress?", "list done tasks". Optional scope filter narrows results to an exact scope value (case-sensitive). Returns { tasks: Task[] } sorted by priority desc then id desc.',
  {
    status: z.enum(['refinement', 'todo', 'in_progress', 'done']).describe('The status to filter by.'),
    scope: z.string().optional().describe('Optional exact scope filter (case-sensitive).'),
  },
  async ({ status, scope }) => text({ tasks: store.getByStatus(status, scope) })
);

// ── getScopes ─────────────────────────────────────────────────────────────────
server.tool(
  'getScopes',
  'List all scopes that exist across active and done tasks — use to discover valid scope values before calling getByScope or getByStatus with a scope filter. Returns { scopes: Array<{ scope, total, open }> }. Sorted: open desc, then total desc, then alphabetically.',
  {},
  async () => text({ scopes: store.getScopes() })
);

// ── delete ────────────────────────────────────────────────────────────────────
server.tool(
  'delete',
  'Permanently remove a task from the database. Use ONLY when the user explicitly asks to delete, remove, drop, or cancel a task — not when work is finished (use setStatus(done) for that). Cascade-removes refs from/to this task. This is irreversible.',
  { id: z.coerce.number().int().positive().describe('The numeric task ID to permanently remove') },
  async ({ id }) => {
    const ok = store.delete(id);
    if (!ok) {
      return errorText({ success: false, error: `Task #${id} not found. Valid IDs are: ${allIdsSorted().join(', ') || 'none'}` });
    }
    return text({ success: true });
  }
);

// ── shutdown ──────────────────────────────────────────────────────────────────
process.on('SIGINT',  () => { try { store.close(); } catch { /* ignore */ } process.exit(0); });
process.on('SIGTERM', () => { try { store.close(); } catch { /* ignore */ } process.exit(0); });
process.on('exit',    () => { try { store.close(); } catch { /* ignore */ } });

// ── start ──────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);

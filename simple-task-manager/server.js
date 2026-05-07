import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  parseTasks,
  writeTasks,
  writeDoneTasks,
  sortByPriority,
  sortForNext,
  applyRefs,
  cascadeDelete,
  RELATIONS,
} from './tasks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASKS_FILE = resolve(process.env.TASKS_FILE);
const DONE_FILE = resolve(process.env.TASKS_DONE_FILE);

const INSTRUCTIONS = `
You are connected to simple-task-manager — a persistent task tracker that survives session restarts and context compaction.
Tasks live in TASKS.md (active) and TASKS_DONE.md (archived) at the project root.

## Critical scheduling rules
- When the user says "schedule X", "TODO X", "add to the list", "FEATURE X", "BUG X", "IDEA X" — call add() and STOP. Do NOT also implement it.
- If the user mentions a bug or feature that is outside the current task's scope, ask whether to schedule it before continuing.
- Suggest next work via getNext (or getAll for the full picture) whenever a task finishes or a session ends.

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

Hand-edited TASKS.md refs with unrecognised relation text are kept verbatim and never auto-mirrored.

## Scope — tagging tasks to an area
Set scope on tasks belonging to a specific tool or area (e.g. "auth", "dashboard"). Query with getByScope — exact, case-sensitive match.
`.trim();

const server = new McpServer(
  { name: 'simple-task-manager', version: '1.3.0' },
  { instructions: INSTRUCTIONS }
);

/**
 * Load both files and return a deduped view. Active takes precedence when
 * the same id appears in both (transient state after a partially-failed move).
 */
function loadState() {
  const { counter, tasks: active } = parseTasks(TASKS_FILE);
  const { tasks: doneRaw } = parseTasks(DONE_FILE);
  const activeIds = new Set(active.map(t => t.id));
  const done = doneRaw.filter(t => !activeIds.has(t.id));
  return { counter, active, done };
}

const refsSchema = z.array(z.object({
  id: z.number().int().positive(),
  relation: z.enum(/** @type {[string, ...string[]]} */(RELATIONS)).default('relates to'),
})).optional();

// ── add ────────────────────────────────────────────────────────────────────────
server.tool(
  'add',
  'Schedule a new task — call this whenever the user reports a bug, requests a feature, shares an idea, or says "schedule" / "TODO" / "add to the list". Do NOT implement the task inline; add it and stop. New tasks default to status "refinement" — the next getNext call will surface it for PM-style clarification questions before it moves to "todo". Pass status: "todo" to skip refinement when the task is already fully specified. Returns { id } of the newly created task.',
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
      .describe('Optional related-task references — use when this task depends on, blocks, or is otherwise connected to existing tasks. Each entry: { id: number, relation?: string }. Relation must be one of: "blocks", "is blocked by", "depends on", "is depended on by", "causes", "is caused by", "tests", "is tested by", "relates to". Default: "relates to". The server automatically writes the inverse on the referenced task — you only need to specify one side.'),
    status: z.enum(['refinement', 'todo']).default('refinement')
      .describe('Initial status. Default "refinement" — task needs PM clarification before work starts. Use "todo" only when the task is already fully specified and needs no further refinement.'),
  },
  async ({ type, priority, title, description, scope, refs, status }) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Validation failed: title must not be empty or whitespace-only.' }) }],
        isError: true
      };
    }

    const { counter, active, done } = loadState();
    const newId = counter + 1;
    const canonRefs = refs?.length ? refs : undefined;
    const newTask = {
      id: newId,
      title: trimmedTitle,
      type,
      priority,
      status,
      scope: scope?.trim() || undefined,
      refs: canonRefs,
      description: description.trim()
    };
    active.unshift(newTask);

    if (canonRefs) {
      const all = [...active, ...done];
      applyRefs(all, newId, [], canonRefs);
      writeTasks(TASKS_FILE, newId, active);
      writeDoneTasks(DONE_FILE, done);
    } else {
      writeTasks(TASKS_FILE, newId, active);
    }

    return { content: [{ type: 'text', text: JSON.stringify({ id: newId }) }] };
  }
);

// ── getByType ──────────────────────────────────────────────────────────────────
server.tool(
  'getByType',
  'Get all tasks of a specific type across all statuses — use for "show me all bugs", "list features", "what ideas do we have?". Includes done tasks. Sorted by priority desc then id desc. Prefer getNext when the user just wants the single recommended next task; prefer getAll for the full open backlog.',
  {
    type: z.enum(['bug', 'feature', 'idea', 'tool', 'other'])
      .describe('Task type to filter: bug | feature | idea | tool | other')
  },
  async ({ type }) => {
    const { active, done } = loadState();
    const all = [...active, ...done];
    const filtered = sortByPriority(all.filter(t => t.type === type));
    return { content: [{ type: 'text', text: JSON.stringify({ tasks: filtered }) }] };
  }
);

// ── getOverview ────────────────────────────────────────────────────────────────
server.tool(
  'getOverview',
  'Get a count summary per type: total tasks and how many are actionable (todo or in_progress). Use for dashboard questions like "how many tasks are there?" or "give me a backlog summary". Returns only types that have at least one task, sorted by actionable count desc. Do NOT use this to answer "what\'s next?" — use getNext for that.',
  {},
  async () => {
    const { active, done } = loadState();
    const all = [...active, ...done];
    const allTypes = ['bug', 'feature', 'idea', 'tool', 'other'];
    const overview = allTypes
      .map(type => {
        const ofType = all.filter(t => t.type === type);
        return {
          type,
          total: ofType.length,
          actionable: ofType.filter(t => t.status === 'todo' || t.status === 'in_progress' || t.status === 'refinement').length
        };
      })
      .filter(o => o.total > 0)
      .sort((a, b) => b.actionable - a.actionable);

    return { content: [{ type: 'text', text: JSON.stringify({ overview }) }] };
  }
);

// ── getNext ────────────────────────────────────────────────────────────────────
server.tool(
  'getNext',
  'Get the single next actionable task — use for "what should I do next?", "what\'s next?", or any recommendation request. Sort order: in_progress first (resume interrupted work), then refinement (needs PM clarification), then todo, then highest priority, then newest id (FILO). Considers refinement, todo, and in_progress tasks. Optional type filter narrows to one category. When no filter is given, apply the project prioritization order: bug > tool > feature > idea > other. IMPORTANT: if the returned task has status "refinement", do NOT start implementing — instead ask the user clarifying questions to refine the description, then promote to "todo" via setStatus.',
  {
    type: z.enum(['bug', 'feature', 'idea', 'tool', 'other']).optional()
      .describe('Narrow to one type (optional). Omit to recommend across all types using the bug > tool > feature > idea > other order.')
  },
  async ({ type }) => {
    const { active } = loadState();
    let actionable = active.filter(t => t.status === 'todo' || t.status === 'in_progress' || t.status === 'refinement');
    if (type) actionable = actionable.filter(t => t.type === type);
    const sorted = sortForNext(actionable);
    return { content: [{ type: 'text', text: JSON.stringify({ task: sorted[0] ?? null }) }] };
  }
);

// ── getAll ─────────────────────────────────────────────────────────────────────
server.tool(
  'getAll',
  'Get every not-done task (todo + in_progress) grouped by type — use for "show me everything", "list all tasks", "full backlog". Groups appear in type order: bug, feature, idea, tool, other. Each group sorted by priority desc then id desc. Does NOT include done tasks — use getByType or getById to look up archived work. Prefer getNext for a single recommendation; prefer getByType when the user asks about one specific type.',
  {},
  async () => {
    const { active } = loadState();
    const actionable = active.filter(t => t.status !== 'done');
    const allTypes = ['bug', 'feature', 'idea', 'tool', 'other'];
    const grouped = {};
    for (const type of allTypes) {
      const ofType = sortByPriority(actionable.filter(t => t.type === type));
      if (ofType.length > 0) grouped[type] = ofType;
    }
    return { content: [{ type: 'text', text: JSON.stringify({ tasks: grouped }) }] };
  }
);

// ── getById ────────────────────────────────────────────────────────────────────
server.tool(
  'getById',
  'Get a single task by its numeric ID — use when the user asks about a specific task by number (e.g. "show me #42", "what is task 37?"). Searches both active and done files. Returns the full task object including scope, refs, and description, or an error listing valid IDs if not found.',
  {
    id: z.coerce.number().int().positive().describe('The numeric task ID to look up')
  },
  async ({ id }) => {
    const { active, done } = loadState();
    const all = [...active, ...done];
    const task = all.find(t => t.id === id);
    if (!task) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Task #${id} not found. Valid IDs: ${all.map(t => t.id).sort((a,b) => a-b).join(', ') || 'none'}`
          })
        }],
        isError: true
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ task }) }] };
  }
);

// ── setStatus ──────────────────────────────────────────────────────────────────
server.tool(
  'setStatus',
  'Update a task\'s status. Lifecycle rules: always call setStatus(in_progress) before starting work on a task; always call setStatus(done) after the commit is made and the user confirms. Setting done automatically moves the task from TASKS.md to TASKS_DONE.md; setting todo or in_progress on a done task moves it back to TASKS.md. Returns { success: true } or { success: false, error }.',
  {
    id: z.coerce.number().int().positive().describe('Task ID — get it from getNext, getAll, getByType, or getById'),
    status: z.enum(['refinement', 'todo', 'in_progress', 'done']).describe('refinement = needs PM clarification before work starts; todo = ready to implement; in_progress = actively being worked on (set this before beginning); done = completed and committed (set this after user confirms the commit)')
  },
  async ({ id, status }) => {
    const { counter, active, done } = loadState();
    let task = active.find(t => t.id === id);
    const wasInActive = !!task;
    if (!task) task = done.find(t => t.id === id);

    if (!task) {
      const allIds = [...active.map(t => t.id), ...done.map(t => t.id)].sort((a, b) => a - b);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Task #${id} not found. Valid IDs are: ${allIds.join(', ') || 'none'}`
          })
        }]
      };
    }

    task.status = status;

    // Desired invariants: done tasks live only in TASKS_DONE.md; non-done only in TASKS.md.
    // Write DONE file first — if we crash mid-move we duplicate rather than lose.
    if (status === 'done') {
      const newActive = active.filter(t => t.id !== id);
      const newDone = done.filter(t => t.id !== id).concat(task);
      writeDoneTasks(DONE_FILE, newDone);
      writeTasks(TASKS_FILE, counter, newActive);
    } else {
      const newDone = done.filter(t => t.id !== id);
      const newActive = wasInActive
        ? active.map(t => (t.id === id ? task : t))
        : active.concat(task);
      writeTasks(TASKS_FILE, counter, newActive);
      writeDoneTasks(DONE_FILE, newDone);
    }

    return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
  }
);

// ── update ────────────────────────────────────────────────────────────────────
server.tool(
  'update',
  'Patch any fields of an existing task in place — use when the user asks to edit, rename, reprioritize, retype, rescope, or update the refs/description of a task. Only the fields you provide are changed; omitted fields keep their current values. Works on both active and done tasks. Returns { success: true, task } with the full updated task, or { success: false, error }.',
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
  async ({ id, title, description, priority, type, scope, refs }) => {
    const { counter, active, done } = loadState();
    const all = [...active, ...done];
    const task = all.find(t => t.id === id);
    const inActive = active.some(t => t.id === id);

    if (!task) {
      const allIds = all.map(t => t.id).sort((a, b) => a - b);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Task #${id} not found. Valid IDs are: ${allIds.join(', ') || 'none'}`
          })
        }]
      };
    }

    const oldRefs = task.refs ? [...task.refs] : [];

    if (title !== undefined) task.title = title.trim();
    if (description !== undefined) task.description = description.trim();
    if (priority !== undefined) task.priority = priority;
    if (type !== undefined) task.type = type;
    if (scope !== undefined) task.scope = scope === null ? undefined : scope.trim() || undefined;
    if (refs !== undefined) task.refs = refs === null || refs.length === 0 ? undefined : refs;

    if (refs !== undefined) {
      applyRefs(all, id, oldRefs, task.refs ?? []);
      writeTasks(TASKS_FILE, counter, active);
      writeDoneTasks(DONE_FILE, done);
    } else if (inActive) {
      writeTasks(TASKS_FILE, counter, active);
    } else {
      writeDoneTasks(DONE_FILE, done);
    }

    return { content: [{ type: 'text', text: JSON.stringify({ success: true, task }) }] };
  }
);

// ── getByScope ────────────────────────────────────────────────────────────────
server.tool(
  'getByScope',
  'Get all tasks tagged with a specific scope — use when the user asks "what tasks are there for svg-path-joiner?" or "show me everything related to eink-frame". Includes all statuses (todo, in_progress, done). Sorted by priority desc then id desc. Scope values are set via add or update.',
  {
    scope: z.string().describe('Exact scope value to filter by (e.g. "svg-path-joiner", "eink-frame", "task-manager"). Must match exactly — scope is case-sensitive.')
  },
  async ({ scope }) => {
    const { active, done } = loadState();
    const all = [...active, ...done];
    const filtered = sortByPriority(all.filter(t => t.scope === scope));
    return { content: [{ type: 'text', text: JSON.stringify({ scope, tasks: filtered }) }] };
  }
);

// ── getRelated ────────────────────────────────────────────────────────────────
server.tool(
  'getRelated',
  'Get tasks related to a given task — use for "what depends on #X?", "what does #X block?", "show me connections for task #X". Returns three things: the task itself, outbound (tasks that #X references, decorated with the relation), and inbound (tasks that reference #X). Because mirroring keeps both sides in sync, outbound and inbound together form the complete graph for this task. Searches both active and done tasks.',
  {
    id: z.coerce.number().int().positive().describe('Task ID to find related tasks for')
  },
  async ({ id }) => {
    const { active, done } = loadState();
    const all = [...active, ...done];

    const task = all.find(t => t.id === id);
    if (!task) {
      const allIds = all.map(t => t.id).sort((a, b) => a - b);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Task #${id} not found. Valid IDs: ${allIds.join(', ') || 'none'}` }) }],
        isError: true
      };
    }

    const outbound = (task.refs ?? []).flatMap(ref => {
      const t = all.find(t => t.id === ref.id);
      return t ? [{ ...t, refRelation: ref.relation }] : [];
    });

    const inbound = all.filter(t => t.id !== id && t.refs?.some(r => r.id === id));

    return { content: [{ type: 'text', text: JSON.stringify({ task, outbound, inbound }) }] };
  }
);

// ── delete ────────────────────────────────────────────────────────────────────
server.tool(
  'delete',
  'Permanently remove a task from both TASKS.md and TASKS_DONE.md. Use ONLY when the user explicitly asks to delete, remove, drop, or cancel a task — not when work is finished (use setStatus(done) for that). Also removes all refs pointing to this task from other tasks. This is irreversible. Returns { success: true } or { success: false, error }.',
  {
    id: z.coerce.number().int().positive().describe('The numeric task ID to permanently remove')
  },
  async ({ id }) => {
    const { counter, active, done } = loadState();
    const inActive = active.some(t => t.id === id);
    const inDone = done.some(t => t.id === id);

    if (!inActive && !inDone) {
      const allIds = [...active.map(t => t.id), ...done.map(t => t.id)].sort((a, b) => a - b);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Task #${id} not found. Valid IDs are: ${allIds.join(', ') || 'none'}`
          })
        }],
        isError: true
      };
    }

    const all = [...active, ...done];
    cascadeDelete(all, id);

    const newActive = active.filter(t => t.id !== id);
    const newDone = done.filter(t => t.id !== id);
    writeTasks(TASKS_FILE, counter, newActive);
    writeDoneTasks(DONE_FILE, newDone);

    return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
  }
);

// ── cleanup ───────────────────────────────────────────────────────────────────
server.tool(
  'cleanup',
  'Maintenance sweep — move every done task from TASKS.md to TASKS_DONE.md and rewrap long description lines at 120 chars. Safe to run anytime; call it after manual file edits or when the user asks to tidy/archive the task list. Returns { archived, activeAfter, doneAfter } counts.',
  {},
  async () => {
    const { counter, active, done } = loadState();

    const doneInActive = active.filter(t => t.status === 'done');
    const remainingActive = active.filter(t => t.status !== 'done');
    const mergedDone = done
      .filter(d => !doneInActive.some(a => a.id === d.id))
      .concat(doneInActive);

    writeDoneTasks(DONE_FILE, mergedDone);
    writeTasks(TASKS_FILE, counter, remainingActive);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          archived: doneInActive.length,
          activeAfter: remainingActive.length,
          doneAfter: mergedDone.length
        })
      }]
    };
  }
);

// ── start ──────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);

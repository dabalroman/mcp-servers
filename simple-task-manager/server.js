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
  sortForNext
} from './tasks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASKS_FILE = resolve(process.env.TASKS_FILE);
const DONE_FILE = resolve(process.env.TASKS_DONE_FILE);

const server = new McpServer({
  name: 'simple-task-manager',
  version: '1.1.0'
});

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

// ── add ────────────────────────────────────────────────────────────────────────
server.tool(
  'add',
  'Schedule a new task — use this whenever the user reports a bug, requests a feature, shares an idea, or asks to "schedule" / "add" / "TODO" something. Do NOT implement the task inline; add it here and stop. Returns the new task id.',
  {
    type: z.enum(['bug', 'feature', 'idea', 'tool', 'other'])
      .describe('bug = defect to fix; feature = planned work requiring /plan; idea = exploratory, needs refinement; tool = developer tooling; other = anything else'),
    priority: z.enum(['low', 'medium', 'high', 'critical'])
      .describe('critical = blocking / data-loss; high = important soon; medium = normal backlog; low = nice-to-have'),
    title: z.string().min(1, 'Title must not be empty')
      .describe('Short, action-oriented title (e.g. "Fix undo animation glitch on session delete")'),
    description: z.string()
      .describe('Full context: what is broken or needed, reproduction steps or acceptance criteria, any technical notes the implementer will need')
  },
  async ({ type, priority, title, description }) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Validation failed: title must not be empty or whitespace-only.' }) }],
        isError: true
      };
    }

    const { counter, tasks } = parseTasks(TASKS_FILE);
    const newId = counter + 1;
    tasks.unshift({
      id: newId,
      title: trimmedTitle,
      type,
      priority,
      status: 'todo',
      description: description.trim()
    });
    writeTasks(TASKS_FILE, newId, tasks);

    return { content: [{ type: 'text', text: JSON.stringify({ id: newId }) }] };
  }
);

// ── getByType ──────────────────────────────────────────────────────────────────
server.tool(
  'getByType',
  'Get all tasks of a specific type — use for "show me all bugs", "list features", "what ideas do we have?". Returns all statuses, sorted by priority desc then id desc. Prefer getNext when the user just wants the single recommended task.',
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
  'Get a count summary of tasks per type (total + actionable). Use ONLY for dashboard-style questions like "how many tasks are there?" or "give me a summary of the backlog". Do NOT use this to answer "what\'s next?" — use getNext for that.',
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
          actionable: ofType.filter(t => t.status === 'todo' || t.status === 'in_progress').length
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
  'Get the single next actionable task — use this for "what should I do next?", "what\'s next?", or any question asking for the next recommended task. in_progress tasks come first, then highest priority, then newest id (FILO). Type filter is optional.',
  {
    type: z.enum(['bug', 'feature', 'idea', 'tool', 'other']).optional()
      .describe('Filter by type (optional). Omit to consider all types.')
  },
  async ({ type }) => {
    const { active } = loadState();
    let actionable = active.filter(t => t.status === 'todo' || t.status === 'in_progress');
    if (type) actionable = actionable.filter(t => t.type === type);
    const sorted = sortForNext(actionable);
    return { content: [{ type: 'text', text: JSON.stringify({ task: sorted[0] ?? null }) }] };
  }
);

// ── getAll ─────────────────────────────────────────────────────────────────────
server.tool(
  'getAll',
  'Get every not-done task grouped by type — use for "show me everything", "list all tasks", "full backlog". Each group sorted by priority desc then id desc. Prefer getNext for "what should I do next?" and getByType when the user asks about one specific type.',
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
  'Get a single task by its numeric ID — use when the user asks about a specific task by number (e.g. "show me #42", "what is task 37?"). Returns full task details or an error if not found.',
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
  'Update a task\'s status — call this when starting work on a task (todo → in_progress), finishing it (→ done), or re-opening it (→ todo). Always set in_progress when beginning a task; always set done after the commit is made and user confirms. Returns { success: true } or { success: false, error }.',
  {
    id: z.coerce.number().int().positive().describe('Task ID from getNext / getAll / getByType'),
    status: z.enum(['todo', 'in_progress', 'done']).describe('todo = not started; in_progress = actively being worked on; done = completed and committed')
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

// ── delete ────────────────────────────────────────────────────────────────────
server.tool(
  'delete',
  'Permanently remove a task from both the active list and the done archive. Use when the user explicitly asks to delete, remove, drop, or cancel a task by id. Irreversible — prefer setStatus(done) when the work is actually complete.',
  {
    id: z.coerce.number().int().positive().describe('The numeric task ID to remove')
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

    if (inActive) writeTasks(TASKS_FILE, counter, active.filter(t => t.id !== id));
    if (inDone) writeDoneTasks(DONE_FILE, done.filter(t => t.id !== id));

    return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
  }
);

// ── cleanup ───────────────────────────────────────────────────────────────────
server.tool(
  'cleanup',
  'Maintenance sweep — move every done task from TASKS.md to TASKS_DONE.md. Pure bookkeeping, safe to run anytime. Use after manual edits or when the user asks to tidy/cleanup/archive the task list.',
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

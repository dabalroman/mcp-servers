import { z } from 'zod';
import { RELATIONS } from '../tasks.js';

export const text = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });
export const errorText = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }], isError: true });

// Token-saving for list responses: when a task has a summary, the full description
// adds noise without value. Agents that need the body call getById.
export function toListTask(task) {
  if (!task.summary) return task;
  const { description: _desc, ...rest } = task;
  return rest;
}

export function allIdsSorted(store) {
  const { active, done } = store.load();
  return [...active.map((t) => t.id), ...done.map((t) => t.id)].sort((a, b) => a - b);
}

export function notFoundError(id, store, { withAre = false } = {}) {
  const verb = withAre ? 'Valid IDs are' : 'Valid IDs';
  return errorText({ error: `Task #${id} not found. ${verb}: ${allIdsSorted(store).join(', ') || 'none'}` });
}

export const refsSchema = z.array(z.object({
  id: z.number().int().positive(),
  relation: z.enum(/** @type {[string, ...string[]]} */(RELATIONS)).default('relates to'),
})).optional();

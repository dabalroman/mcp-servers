import { z } from 'zod';
import { RELATIONS, type Task, type Store } from '../tasks.js';

export type MCPContent = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

export const text = (obj: unknown): MCPContent => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });
export const errorText = (obj: unknown): MCPContent => ({ content: [{ type: 'text', text: JSON.stringify(obj) }], isError: true });

// Token-saving for list responses: when a task has a summary, the full description
// adds noise without value. Agents that need the body call getById.
export function toListTask<T extends Task>(task: T): T | Omit<T, 'description'> {
  if (!task.summary) return task;
  const { description: _desc, ...rest } = task;
  return rest;
}

export function allIdsSorted(store: Store): number[] {
  const { active, done } = store.load();
  return [...active.map((t) => t.id), ...done.map((t) => t.id)].sort((a, b) => a - b);
}

export function notFoundError(id: number, store: Store, { withAre = false }: { withAre?: boolean } = {}): MCPContent {
  const verb = withAre ? 'Valid IDs are' : 'Valid IDs';
  return errorText({ error: `Task #${id} not found. ${verb}: ${allIdsSorted(store).join(', ') || 'none'}` });
}

export const refsSchema = z.array(z.object({
  id: z.number().int().positive(),
  relation: z.enum(RELATIONS as unknown as [string, ...string[]]).default('relates to'),
})).optional();

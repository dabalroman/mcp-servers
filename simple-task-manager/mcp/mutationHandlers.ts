import { text, errorText, notFoundError, type MCPContent } from './shared.js';
import type { AddInput, Store, TaskStatus, UpdatePatch } from '../tasks.js';

export function handleAdd(store: Store, args: AddInput): MCPContent {
  try {
    const { id } = store.add(args);
    return text({ id });
  } catch (err) {
    return errorText({ error: err instanceof Error ? err.message : String(err) });
  }
}

export function handleUpdate(store: Store, { id, ...patch }: UpdatePatch & { id: number }): MCPContent {
  const result = store.update(id, patch);
  if (!result) return notFoundError(id, store, { withAre: true });
  const response: { success: true; task: typeof result.task; summaryReminder?: string } = {
    success: true,
    task: result.task,
  };
  if (result.task.status === 'refinement' && !result.task.summary) {
    response.summaryReminder = 'This task is in refinement. Before promoting to todo, add a 2–3 line summary via update({ id, summary: "..." }).';
  }
  return text(response);
}

export function handleSetStatus(store: Store, { id, status }: { id: number; status: TaskStatus }): MCPContent {
  if (status === 'todo') {
    const task = store.getById(id);
    if (task && task.status === 'refinement' && !task.summary) {
      return errorText({ error: `Task #${id} must have a summary before being promoted to todo. Call update({ id: ${id}, summary: "2–3 line gist" }) first, then retry setStatus.` });
    }
  }
  const ok = store.setStatus(id, status);
  if (!ok) return notFoundError(id, store, { withAre: true });
  const result: { success: true; knowledgeReminder?: string } = { success: true };
  if (status === 'done') {
    result.knowledgeReminder = 'Task closed. Before moving on: (1) identify non-obvious decisions, gotchas, conventions, or architecture changes from this task; (2) update the closest relevant CLAUDE.md with anything genuinely new — keep entries terse and deduped; (3) prune or correct any entries now stale or contradicted. Skip if nothing worth capturing.';
  }
  return text(result);
}

export function handleDelete(store: Store, { id }: { id: number }): MCPContent {
  const ok = store.delete(id);
  if (!ok) return notFoundError(id, store, { withAre: true });
  return text({ success: true });
}

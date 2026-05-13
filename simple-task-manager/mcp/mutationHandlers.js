import { text, errorText, notFoundError } from './shared.js';

export function handleAdd(store, { type, priority, title, description, scope, summary, refs, status }) {
  try {
    const { id } = store.add({ type, priority, title, description, scope, summary, refs, status });
    return text({ id });
  } catch (err) {
    return errorText({ error: err.message });
  }
}

export function handleUpdate(store, { id, ...patch }) {
  const result = store.update(id, patch);
  if (!result) return notFoundError(id, store, { withAre: true });
  const response = { success: true, task: result.task };
  if (result.task.status === 'refinement' && !result.task.summary) {
    response.summaryReminder = 'This task is in refinement. Before promoting to todo, add a 2–3 line summary via update({ id, summary: "..." }).';
  }
  return text(response);
}

export function handleSetStatus(store, { id, status }) {
  if (status === 'todo') {
    const task = store.getById(id);
    if (task && task.status === 'refinement' && !task.summary) {
      return errorText({ error: `Task #${id} must have a summary before being promoted to todo. Call update({ id: ${id}, summary: "2–3 line gist" }) first, then retry setStatus.` });
    }
  }
  const ok = store.setStatus(id, status);
  if (!ok) return notFoundError(id, store, { withAre: true });
  const result = { success: true };
  if (status === 'done') {
    result.knowledgeReminder = 'Task closed. Before moving on: (1) identify non-obvious decisions, gotchas, conventions, or architecture changes from this task; (2) update the closest relevant CLAUDE.md with anything genuinely new — keep entries terse and deduped; (3) prune or correct any entries now stale or contradicted. Skip if nothing worth capturing.';
  }
  return text(result);
}

export function handleDelete(store, { id }) {
  const ok = store.delete(id);
  if (!ok) return notFoundError(id, store, { withAre: true });
  return text({ success: true });
}

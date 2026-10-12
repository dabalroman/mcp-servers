import { readFileSync } from 'node:fs';
import { text, errorText, notFoundError, probeTcp, type MCPContent } from './shared.js';
import type { AddInput, Store, TaskStatus, UpdatePatch } from '../tasks.js';
import { checkPlanPath, defaultPlanRoots } from './planPath.js';
import { uiPkgDir, uiServerEntry, getUiChild, setUiChild, spawnUi } from './uiChild.js';

const UI_PORT = parseInt(process.env['TASK_UI_PORT'] ?? '7374', 10);

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
  // plan and note bodies omitted from the echo (can be large); getById returns them
  const { plan: _plan, notes, ...rest } = result.task;
  const task = notes ? { ...rest, noteCount: notes.length } : rest;
  const response: { success: true; task: typeof task; summaryReminder?: string } = {
    success: true,
    task,
  };
  if (result.task.status === 'refinement' && !result.task.summary && !('summary' in patch)) {
    response.summaryReminder = 'This task is in refinement. Before promoting to todo, add a 2–3 line summary via update({ id, summary: "..." }).';
  }
  return text(response);
}

export function handleReplace(
  store: Store,
  { id, field, anchor, replace_with }: { id: number; field: 'description' | 'plan'; anchor: string; replace_with: string },
): MCPContent {
  const task = store.getById(id);
  if (!task) return notFoundError(id, store, { withAre: true });
  const current = task[field] ?? '';
  const first = current.indexOf(anchor);
  if (first === -1) return errorText({ error: `anchor not found in ${field} (match is exact: case- and whitespace-sensitive; copy the anchor verbatim from getById)` });
  let count = 1;
  // step by 1, not anchor.length, so overlapping occurrences are counted
  for (let i = current.indexOf(anchor, first + 1); i !== -1; i = current.indexOf(anchor, i + 1)) count++;
  if (count > 1) return errorText({ error: `anchor matched ${count} times in ${field} — extend it to be unique` });
  // slice-splice rather than String.replace to avoid $-pattern substitution in replace_with
  store.update(id, { [field]: current.slice(0, first) + replace_with + current.slice(first + anchor.length) });
  return text({ success: true, id, field });
}

export function handleUploadPlan(
  store: Store,
  { id, path }: { id: number; path: string },
  roots: string[] = defaultPlanRoots(),
): MCPContent {
  const checked = checkPlanPath(path, roots);
  if (!checked.ok) return errorText({ error: checked.error });
  let content: string;
  try {
    content = readFileSync(checked.path, 'utf8');
  } catch (err) {
    return errorText({ error: `cannot read ${path}: ${err instanceof Error ? err.message : String(err)}` });
  }
  // store.update trims plan and stores whitespace-only as null, which would silently clear it
  if (content.trim() === '') return errorText({ error: `${path} is empty — refusing to clear the plan` });
  if (!store.update(id, { plan: content })) return notFoundError(id, store, { withAre: true });
  return text({ success: true, id, bytes: Buffer.byteLength(content, 'utf8') });
}

export function handleAddNote(store: Store, { taskId, body }: { taskId: number; body: string }): MCPContent {
  try {
    const note = store.addNote(taskId, body);
    if (!note) return notFoundError(taskId, store, { withAre: true });
    return text({ success: true, note });
  } catch (err) {
    return errorText({ error: err instanceof Error ? err.message : String(err) });
  }
}

export function handleUpdateNote(store: Store, { noteId, body }: { noteId: number; body: string }): MCPContent {
  try {
    const note = store.updateNote(noteId, body);
    if (!note) return errorText({ error: `Note #${noteId} not found.` });
    return text({ success: true, note });
  } catch (err) {
    return errorText({ error: err instanceof Error ? err.message : String(err) });
  }
}

export function handleDeleteNote(store: Store, { noteId }: { noteId: number }): MCPContent {
  if (!store.deleteNote(noteId)) return errorText({ error: `Note #${noteId} not found.` });
  return text({ success: true });
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

export async function handleUiStart(): Promise<MCPContent> {
  const uiMode = process.env['TASK_UI_MODE'] ?? 'bundled';
  if (uiMode === 'standalone') {
    const name = process.env['PROJECT_NAME'] ?? '<PROJECT_NAME>';
    return errorText({ error: `UI is pm2-managed (TASK_UI_MODE=standalone). Use \`pm2 restart ${name}\` to control it.` });
  }
  if (uiMode === 'disabled') {
    return errorText({ error: 'TASK_UI_MODE=disabled — UI is intentionally off. Set TASK_UI_MODE=bundled in .mcp.json and restart the MCP to enable it.' });
  }

  const running = await probeTcp(UI_PORT, 1000);
  if (running) {
    return text({ started: false, alreadyRunning: true, port: UI_PORT });
  }

  if (!uiServerEntry || !uiPkgDir) {
    return errorText({ error: `task-manager-ui not found at any expected location — the sub-package may not be installed.` });
  }

  spawnUi();

  // Give the process ~1 s to bind its port before confirming
  await new Promise<void>((r) => setTimeout(r, 1000));
  const confirmed = await probeTcp(UI_PORT, 1000);

  return text({ started: true, confirmed, port: UI_PORT });
}

export async function handleUiStop(): Promise<MCPContent> {
  if (process.env['TASK_UI_MODE'] === 'standalone') {
    const name = process.env['PROJECT_NAME'] ?? '<PROJECT_NAME>';
    return errorText({ error: `UI is pm2-managed (TASK_UI_MODE=standalone). Use \`pm2 stop ${name}\` to control it.` });
  }
  const running = await probeTcp(UI_PORT, 1000);
  if (!running) {
    return text({ stopped: false, notRunning: true });
  }

  const child = getUiChild();

  if (child === null) {
    return text({
      stopped: false,
      externalProcess: true,
      message: `UI is running on port ${UI_PORT} but was not started by this MCP — stop it manually.`,
    });
  }

  if (child.pid !== undefined && !child.killed) {
    try {
      process.kill(child.pid, 0); // verify PID is still alive before sending signal
      child.kill('SIGTERM');
    } catch { /* process already gone — proceed to clear the reference */ }
  }
  setUiChild(null);

  // Re-probe to confirm the port was released
  await new Promise<void>((r) => setTimeout(r, 500));
  const stillBound = await probeTcp(UI_PORT, 500);
  if (stillBound) {
    return text({
      stopped: false,
      staleReference: true,
      message: `Port ${UI_PORT} is still bound after SIGTERM — another process may own it. Stop it manually.`,
    });
  }

  return text({ stopped: true, port: UI_PORT });
}

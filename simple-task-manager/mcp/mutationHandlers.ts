import { text, errorText, notFoundError, probeTcp, type MCPContent } from './shared.js';
import { existsSync } from 'node:fs';
import type { AddInput, Store, TaskStatus, UpdatePatch } from '../tasks.js';

// Resolved lazily to avoid a circular import at module load time: server.ts
// imports registerTools → mutationHandlers, so we import server.ts only when
// the handler is actually invoked (post-startup).
async function getServerExports() {
  const mod = await import('../server.js');
  return mod as {
    uiPkgDir: string;
    uiServerEntry: string;
    resolvedTasksDb: string;
    getUiChild: () => import('node:child_process').ChildProcess | null;
    setUiChild: (child: import('node:child_process').ChildProcess | null) => void;
    spawnUi: () => void;
  };
}

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
  const response: { success: true; task: typeof result.task; summaryReminder?: string } = {
    success: true,
    task: result.task,
  };
  if (result.task.status === 'refinement' && !result.task.summary && !('summary' in patch)) {
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

  const srv = await getServerExports();
  if (!existsSync(srv.uiServerEntry)) {
    return errorText({ error: `task-manager-ui not found at ${srv.uiPkgDir} — the sub-package may not be installed.` });
  }

  srv.spawnUi();

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

  const srv = await getServerExports();
  const child = srv.getUiChild();

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
  srv.setUiChild(null);

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

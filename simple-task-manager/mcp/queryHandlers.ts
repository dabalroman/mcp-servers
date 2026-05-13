import { text, toListTask, notFoundError, type MCPContent } from './shared.js';
import type { Store, Task, TaskStatus, TaskType } from '../tasks.js';

export function handleGetByType(store: Store, { type }: { type: TaskType }): MCPContent {
  return text({ tasks: store.getByType(type).map(toListTask) });
}

export function handleGetOverview(store: Store): MCPContent {
  return text({ overview: store.getOverview() });
}

export function handleGetNext(store: Store, { type }: { type?: TaskType } = {}): MCPContent {
  const task = store.getNext(type);
  return text({ task: task ? toListTask(task) : null });
}

export function handleGetAll(store: Store): MCPContent {
  const allTypes: TaskType[] = ['bug', 'feature', 'idea', 'tool', 'other'];
  const grouped: Record<string, (Task | Omit<Task, 'description'>)[]> = {};
  for (const type of allTypes) {
    const ofType = store.getByType(type).filter((t) => t.status !== 'done').map(toListTask);
    if (ofType.length > 0) grouped[type] = ofType;
  }
  return text({ tasks: grouped });
}

export function handleGetById(store: Store, { id }: { id: number }): MCPContent {
  const task = store.getById(id);
  if (!task) return notFoundError(id, store);
  return text({ task });
}

export function handleGetByScope(store: Store, { scope }: { scope: string }): MCPContent {
  return text({ scope, tasks: store.getByScope(scope).map(toListTask) });
}

export function handleGetRelated(store: Store, { id }: { id: number }): MCPContent {
  const result = store.getRelated(id);
  if (!result) return notFoundError(id, store);
  return text({
    task: result.task,
    outbound: result.outbound.map((t) => ({ ...toListTask(t), refRelation: t.refRelation })),
    inbound:  result.inbound.map((t)  => ({ ...toListTask(t), refRelation: t.refRelation })),
  });
}

export function handleGetByStatus(store: Store, { status, scope }: { status: TaskStatus; scope?: string }): MCPContent {
  return text({ tasks: store.getByStatus(status, scope).map(toListTask) });
}

export function handleGetScopes(store: Store): MCPContent {
  return text({ scopes: store.getScopes() });
}

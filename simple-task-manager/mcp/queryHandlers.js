import { text, toListTask, notFoundError } from './shared.js';

export function handleGetByType(store, { type }) {
  return text({ tasks: store.getByType(type).map(toListTask) });
}

export function handleGetOverview(store) {
  return text({ overview: store.getOverview() });
}

export function handleGetNext(store, { type } = {}) {
  const task = store.getNext(type);
  return text({ task: task ? toListTask(task) : null });
}

export function handleGetAll(store) {
  const allTypes = ['bug', 'feature', 'idea', 'tool', 'other'];
  const grouped = {};
  for (const type of allTypes) {
    const ofType = store.getByType(type).filter((t) => t.status !== 'done').map(toListTask);
    if (ofType.length > 0) grouped[type] = ofType;
  }
  return text({ tasks: grouped });
}

export function handleGetById(store, { id }) {
  const task = store.getById(id);
  if (!task) return notFoundError(id, store);
  return text({ task });
}

export function handleGetByScope(store, { scope }) {
  return text({ scope, tasks: store.getByScope(scope).map(toListTask) });
}

export function handleGetRelated(store, { id }) {
  const result = store.getRelated(id);
  if (!result) return notFoundError(id, store);
  return text({
    task: result.task,
    outbound: result.outbound.map((t) => ({ ...toListTask(t), refRelation: t.refRelation })),
    inbound:  result.inbound.map((t)  => ({ ...toListTask(t), refRelation: t.refRelation })),
  });
}

export function handleGetByStatus(store, { status, scope }) {
  return text({ tasks: store.getByStatus(status, scope).map(toListTask) });
}

export function handleGetScopes(store) {
  return text({ scopes: store.getScopes() });
}

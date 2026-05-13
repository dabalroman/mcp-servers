import type { Task } from '@/types/task';

export type TaskLocation = {
  tab: 'active' | 'done';
  scope: string;
};

const NO_SCOPE_LABEL = '(no scope)';

export function findTaskLocation(
  active: Task[],
  done: Task[],
  id: number,
): TaskLocation | null {
  const inActive = active.find((t) => t.id === id);
  if (inActive) {
    return { tab: 'active', scope: inActive.scope ?? NO_SCOPE_LABEL };
  }
  const inDone = done.find((t) => t.id === id);
  if (inDone) {
    return { tab: 'done', scope: inDone.scope ?? NO_SCOPE_LABEL };
  }
  return null;
}

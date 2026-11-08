import type { Task } from '@/types/task';
import type { GroupBy } from '@/lib/taskView';
import { getSectionValue } from '@/lib/taskView';

export type TaskLocation = {
  tab: 'active' | 'done';
  sectionValue: string;
};

export function findTaskLocation(
  active: Task[],
  done: Task[],
  id: number,
  groupBy: GroupBy,
): TaskLocation | null {
  const inActive = active.find((t) => t.id === id);
  if (inActive) {
    return { tab: 'active', sectionValue: getSectionValue(epicOrSelf(inActive, active), groupBy) };
  }
  const inDone = done.find((t) => t.id === id);
  if (inDone) {
    return { tab: 'done', sectionValue: getSectionValue(epicOrSelf(inDone, done), groupBy) };
  }
  return null;
}

// A child nested under its epic renders in the epic's section, whatever its own group value.
function epicOrSelf(task: Task, list: Task[]): Task {
  if (task.parentId === undefined) return task;
  return list.find((t) => t.id === task.parentId && t.type === 'epic') ?? task;
}

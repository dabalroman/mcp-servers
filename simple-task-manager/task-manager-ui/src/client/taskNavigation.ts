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
    return { tab: 'active', sectionValue: getSectionValue(inActive, groupBy) };
  }
  const inDone = done.find((t) => t.id === id);
  if (inDone) {
    return { tab: 'done', sectionValue: getSectionValue(inDone, groupBy) };
  }
  return null;
}

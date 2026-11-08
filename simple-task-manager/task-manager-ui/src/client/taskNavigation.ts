import type { Task } from '@/types/task';
import type { GroupBy, SortBy, SortDir } from '@/lib/taskView';
import { getSectionValue, nestEpicChildren } from '@/lib/taskView';

export type TaskLocation = {
  tab: 'active' | 'done';
  sectionValue: string;
};

export function findTaskLocation(
  active: Task[],
  done: Task[],
  id: number,
  groupBy: GroupBy,
  sortBy: SortBy,
  sortDir: SortDir,
): TaskLocation | null {
  const inActive = active.find((t) => t.id === id);
  if (inActive) {
    return { tab: 'active', sectionValue: sectionValueIn(inActive, active, done, groupBy, sortBy, sortDir) };
  }
  const inDone = done.find((t) => t.id === id);
  if (inDone) {
    return { tab: 'done', sectionValue: sectionValueIn(inDone, done, active, groupBy, sortBy, sortDir) };
  }
  return null;
}

// Mirrors the tab's nesting: a nested child renders in its epic block's section, and an epic
// pulled in from the other tab takes its anchor child's section.
function sectionValueIn(task: Task, own: Task[], others: Task[], groupBy: GroupBy, sortBy: SortBy, sortDir: SortDir): string {
  const tree = nestEpicChildren(own, others, sortBy, sortDir);
  const rootId = task.parentId !== undefined && tree.childrenByEpic.has(task.parentId) ? task.parentId : task.id;
  const root = tree.anchors.get(rootId) ?? tree.roots.find((t) => t.id === rootId) ?? task;
  return getSectionValue(root, groupBy);
}

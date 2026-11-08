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
  currentTab: 'active' | 'done' = 'active',
): TaskLocation | null {
  // A task can show in both tabs (nested under an epic, or as a pulled-in epic); stay put if it's visible here.
  const order: ('active' | 'done')[] = currentTab === 'active' ? ['active', 'done'] : ['done', 'active'];
  for (const tab of order) {
    const sectionValue = tab === 'active'
      ? sectionValueIn(id, active, done, groupBy, sortBy, sortDir)
      : sectionValueIn(id, done, active, groupBy, sortBy, sortDir);
    if (sectionValue !== null) return { tab, sectionValue };
  }
  return null;
}

// Mirrors the tab's nesting: a nested child renders in its epic block's section, and an epic
// pulled in from the other tab takes its anchor child's section. null when the tab doesn't show it.
function sectionValueIn(id: number, own: Task[], others: Task[], groupBy: GroupBy, sortBy: SortBy, sortDir: SortDir): string | null {
  const tree = nestEpicChildren(own, others, sortBy, sortDir);
  let rootId: number | undefined = tree.roots.some((t) => t.id === id) ? id : undefined;
  if (rootId === undefined) {
    for (const [epicId, kids] of tree.childrenByEpic) {
      if (kids.some((t) => t.id === id)) { rootId = epicId; break; }
    }
  }
  if (rootId === undefined) return null;
  const root = tree.anchors.get(rootId) ?? tree.roots.find((t) => t.id === rootId);
  return root ? getSectionValue(root, groupBy) : null;
}

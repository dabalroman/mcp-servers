import { sortByPriority } from './constants';
import type { Task } from '@/types/task';

const NO_SCOPE_LABEL = '(no scope)';

export function groupTasksByScope(
  tasks: Task[],
  mode: 'active' | 'done',
): { scope: string; tasks: Task[] }[] {
  const source = mode === 'done' ? [...tasks].sort((a, b) => b.id - a.id) : tasks;
  const map = new Map<string, Task[]>();
  for (const t of source) {
    const key = t.scope ?? NO_SCOPE_LABEL;
    const list = map.get(key);
    if (list) list.push(t);
    else map.set(key, [t]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => {
      if (a === NO_SCOPE_LABEL) return 1;
      if (b === NO_SCOPE_LABEL) return -1;
      return a.localeCompare(b);
    })
    .map(([scope, scopeTasks]) => ({
      scope,
      tasks: mode === 'active' ? sortByPriority(scopeTasks) : scopeTasks,
    }));
}

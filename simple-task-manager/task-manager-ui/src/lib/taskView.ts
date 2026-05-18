import type { Task, TaskPriority, TaskStatus, TaskType } from '@/types/task';

export type GroupBy = 'none' | 'scope' | 'status' | 'type' | 'priority';
export type SortBy = 'priority' | 'status' | 'created_at' | 'updated_at';
export type SortDir = 'asc' | 'desc';

export type ViewState = {
  groupBy: GroupBy;
  groupDir: SortDir;
  sortBy: SortBy;
  sortDir: SortDir;
};

export type GroupSection = {
  label: string;
  value: string;
  tasks: Task[];
};

const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const STATUS_RANK: Record<TaskStatus, number> = { in_progress: 5, todo: 4, plan: 3, refinement: 2, done: 1 };

const PRIORITY_ORDER: TaskPriority[] = ['critical', 'high', 'medium', 'low'];
const STATUS_ORDER: TaskStatus[] = ['in_progress', 'todo', 'plan', 'refinement', 'done'];
const TYPE_ORDER: TaskType[] = ['bug', 'tool', 'feature', 'idea', 'other'];

const NO_SCOPE = '(no scope)';

export const DEFAULT_VIEW: ViewState = { groupBy: 'scope', groupDir: 'asc', sortBy: 'priority', sortDir: 'desc' };

export function sortTasks(tasks: Task[], sortBy: SortBy, sortDir: SortDir): Task[] {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...tasks].sort((a, b) => {
    let diff = 0;
    if (sortBy === 'priority') {
      diff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]; // asc base: low first
    } else if (sortBy === 'status') {
      diff = STATUS_RANK[a.status] - STATUS_RANK[b.status]; // asc base: done first
    } else if (sortBy === 'created_at') {
      diff = a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
    } else {
      diff = a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : 0;
    }
    if (diff !== 0) return diff * dir;
    return b.id - a.id; // secondary: always newer id first
  });
}

export function getSectionValue(task: Task, groupBy: GroupBy): string {
  if (groupBy === 'scope') return task.scope ?? NO_SCOPE;
  if (groupBy === 'status') return task.status;
  if (groupBy === 'type') return task.type;
  if (groupBy === 'priority') return task.priority;
  return '';
}

function sectionLabel(groupBy: GroupBy, value: string): string {
  if (groupBy === 'none') return '';
  if (groupBy === 'status') {
    const map: Record<TaskStatus, string> = {
      in_progress: 'In Progress', todo: 'To Do', plan: 'Plan', refinement: 'Refinement', done: 'Done',
    };
    return map[value as TaskStatus] ?? value;
  }
  if (value === NO_SCOPE) return '(no scope)';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function sectionOrder(groupBy: GroupBy, value: string): number {
  if (groupBy === 'priority') return PRIORITY_ORDER.indexOf(value as TaskPriority);
  if (groupBy === 'status') return STATUS_ORDER.indexOf(value as TaskStatus);
  if (groupBy === 'type') return TYPE_ORDER.indexOf(value as TaskType);
  return 0;
}

export function groupTasks(tasks: Task[], groupBy: GroupBy, groupDir: SortDir = 'desc'): GroupSection[] {
  if (groupBy === 'none') {
    return [{ label: '', value: '', tasks }];
  }

  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    const value = getSectionValue(task, groupBy);
    const bucket = map.get(value);
    if (bucket) bucket.push(task);
    else map.set(value, [task]);
  }

  const sections = [...map.entries()].map(([value, sectionTasks]) => ({
    label: sectionLabel(groupBy, value),
    value,
    tasks: sectionTasks,
  }));

  if (groupBy === 'scope') {
    sections.sort((a, b) => {
      if (a.value === NO_SCOPE) return 1;
      if (b.value === NO_SCOPE) return -1;
      const cmp = a.value.localeCompare(b.value);
      return groupDir === 'asc' ? cmp : -cmp;
    });
  } else {
    // canonical arrays are already in "desc" (most important first) order;
    // ascending by index = desc by importance, so flip dir for asc
    const dir = groupDir === 'desc' ? 1 : -1;
    sections.sort((a, b) => (sectionOrder(groupBy, a.value) - sectionOrder(groupBy, b.value)) * dir);
  }

  return sections;
}

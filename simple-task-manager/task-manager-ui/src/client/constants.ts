import { CANONICAL_RELATIONS } from '@/types/task';
import type { TaskType, TaskPriority, TaskStatus } from '@/types/task';

export const RELATIONS = CANONICAL_RELATIONS;

export const TYPE_ORDER: TaskType[] = ['bug', 'tool', 'feature', 'idea', 'other'];

export const TYPE_LABELS: Record<TaskType, string> = {
  bug: 'BUG',
  tool: 'TOOL',
  feature: 'FEAT',
  idea: 'IDEA',
  other: 'OTHER',
};

export const PRIORITY_CLASSES: Record<TaskPriority, string> = {
  critical: 'bg-destructive/20 text-destructive border-destructive/40',
  high:     'bg-primary/15 text-primary border-primary/30',
  medium:   'bg-secondary text-secondary-foreground border-border',
  low:      'bg-muted text-muted-foreground border-border',
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  refinement:  'REFINEMENT',
  plan:        'PLAN',
  todo:        'TODO',
  in_progress: 'IN PROGRESS',
  done:        'DONE',
};

export const STATUS_NEXT: Record<TaskStatus, TaskStatus> = {
  refinement:  'plan',
  plan:        'todo',
  todo:        'in_progress',
  in_progress: 'done',
  done:        'refinement',
};

export const STATUS_CLASSES: Record<TaskStatus, string> = {
  refinement:  'border-warning text-warning',
  plan:        'border-violet-400/60 text-violet-400',
  todo:        'border-border text-muted-foreground',
  in_progress: 'border-primary text-primary',
  done:        'border-muted-foreground/30 text-muted-foreground/50',
};

export const TYPES: TaskType[] = ['bug', 'feature', 'idea', 'tool', 'other'];
export const PRIORITIES: TaskPriority[] = ['critical', 'high', 'medium', 'low'];

const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function sortByPriority<T extends { priority: TaskPriority; id: number }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const pd = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    return pd !== 0 ? pd : b.id - a.id;
  });
}

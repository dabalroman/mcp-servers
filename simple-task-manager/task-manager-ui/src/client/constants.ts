import { PenLine, GitPullRequest, CircleCheck, ThumbsUp, GitMerge, Rocket, CircleX, type LucideIcon } from 'lucide-react';
import { CANONICAL_RELATIONS } from '@/types/task';
import type { TaskType, TaskPriority, TaskStatus, PrStatus } from '@/types/task';

export const RELATIONS = CANONICAL_RELATIONS;

export const TYPE_ORDER: TaskType[] = ['bug', 'tool', 'feature', 'idea', 'other', 'epic'];

export const TYPE_LABELS: Record<TaskType, string> = {
  bug: 'BUG',
  tool: 'TOOL',
  feature: 'FEAT',
  idea: 'IDEA',
  other: 'OTHER',
  epic: 'EPIC',
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
  done:        'border-success/60 text-success',
};

// Text-only status colour for the id inside a ref pill; the pill itself stays neutral.
export const REF_STATUS_CLASSES: Record<TaskStatus, string> = {
  refinement:  'text-warning/80',
  plan:        'text-violet-400/80',
  todo:        'text-muted-foreground',
  in_progress: 'text-primary/80',
  done:        'text-success/80',
};

export const PR_STATUS_CLASSES: Record<PrStatus, string> = {
  draft:  'border-dashed border-border text-muted-foreground',
  open:   'border-primary text-primary',
  pipeline_pass: 'border-border text-muted-foreground',
  approved: 'border-border text-muted-foreground',
  merged: 'border-border text-muted-foreground',
  deployed: 'border-border text-muted-foreground',
  closed: 'border-border text-muted-foreground/60 line-through',
};

// Statuses are told apart by icon, not colour — the card already carries enough colour.
export const PR_STATUS_ICONS: Record<PrStatus, LucideIcon> = {
  draft: PenLine,
  open: GitPullRequest,
  pipeline_pass: CircleCheck,
  approved: ThumbsUp,
  merged: GitMerge,
  deployed: Rocket,
  closed: CircleX,
};

export const TYPES: TaskType[] = ['bug', 'feature', 'idea', 'tool', 'other', 'epic'];
export const PRIORITIES: TaskPriority[] = ['critical', 'high', 'medium', 'low'];

const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function sortByPriority<T extends { priority: TaskPriority; id: number }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const pd = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    return pd !== 0 ? pd : b.id - a.id;
  });
}

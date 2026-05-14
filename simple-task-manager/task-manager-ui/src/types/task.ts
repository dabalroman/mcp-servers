export type TaskType = 'bug' | 'feature' | 'idea' | 'tool' | 'other';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type TaskStatus = 'refinement' | 'todo' | 'in_progress' | 'done';

export const CANONICAL_RELATIONS = [
  'blocks',
  'is blocked by',
  'depends on',
  'is depended on by',
  'causes',
  'is caused by',
  'tests',
  'is tested by',
  'relates to',
] as const;

export type Relation = typeof CANONICAL_RELATIONS[number];

export type TaskRef = {
  id: number;
  relation: string;
  nonCanonical?: true;
};

export type Task = {
  id: number;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  title: string;
  description?: string;
  summary?: string;
  plan?: string;
  scope?: string;
  refs?: TaskRef[];
};

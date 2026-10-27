export type TaskType = 'bug' | 'feature' | 'idea' | 'tool' | 'other' | 'epic';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type TaskStatus = 'refinement' | 'plan' | 'todo' | 'in_progress' | 'done';

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

export type Note = {
  id: number;
  task_id: number;
  body: string;
  created_at: string;
  updated_at: string;
};

export type Project = { name: string; total: number; open: number };

export type Task = {
  id: number;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  project: string;
  title: string;
  description?: string;
  summary?: string;
  plan?: string;
  scope?: string;
  parentId?: number;
  externalId: string | null;
  epicTitle?: string;
  refs?: TaskRef[];
  notes?: Note[];
  noteCount?: number;
  created_at: string;
  updated_at: string;
};

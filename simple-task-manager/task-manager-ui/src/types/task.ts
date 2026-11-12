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

// id is the identity (URLs, task.project, API keys); name is display only.
export type Project = { id: string; name: string; description: string; total: number; open: number; trackPrs: boolean };

export type PrStatus = 'draft' | 'open' | 'pipeline_pass' | 'approved' | 'merged' | 'deployed' | 'closed';

export type PullRequest = {
  url: string;
  number: number;
  status: PrStatus;
};

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
  // Execution step among the epic's children (10, 20, 30; equal = parallel group).
  seq?: number;
  externalId: string | null;
  epicTitle?: string;
  refs?: TaskRef[];
  prs?: PullRequest[];
  notes?: Note[];
  noteCount?: number;
  created_at: string;
  updated_at: string;
};

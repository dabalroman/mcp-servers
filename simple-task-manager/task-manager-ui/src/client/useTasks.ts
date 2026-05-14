import { useState, useEffect, useCallback } from 'react';
import type { Task, TaskRef, TaskStatus, TaskType, TaskPriority } from '@/types/task';

export type TasksPayload = {
  counter: number;
  active: Task[];
  done: Task[];
};

export type NewTaskInput = {
  title: string;
  type: TaskType;
  priority: TaskPriority;
  description?: string;
  summary?: string;
  plan?: string;
  scope?: string;
  refs?: TaskRef[];
  status?: TaskStatus;
};

export type TaskPatch = Partial<{
  title: string;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  description: string;
  summary: string | null;
  plan: string | null;
  scope: string | null;
  refs: TaskRef[] | null;
}>;

async function fetchTasks(): Promise<TasksPayload> {
  const res = await fetch('/api/tasks');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function useTasks() {
  const [data, setData] = useState<TasksPayload>({ counter: 0, active: [], done: [] });
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(() => {
    fetchTasks().then(setData).catch(setError);
  }, []);

  useEffect(() => {
    refresh();

    const es = new EventSource('/api/tasks/stream');
    es.addEventListener('tasks-changed', refresh);
    es.onerror = () => {};

    return () => es.close();
  }, [refresh]);

  const add = useCallback(async (body: NewTaskInput): Promise<number> => {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json() as { id: number };
    return json.id;
  }, []);

  const update = useCallback(async (id: number, patch: TaskPatch) => {
    const res = await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }, []);

  const remove = useCallback(async (id: number) => {
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }, []);

  return { data, error, refresh, add, update, remove };
}

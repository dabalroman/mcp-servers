import { useState, useEffect, useCallback, useRef } from 'react';
import { WATCHDOG_INTERVAL_MS, isStreamStale, shouldRefetchOnReturn } from './streamHealth';
import type { Task, TaskRef, TaskStatus, TaskType, TaskPriority } from '@/types/task';

export type TasksPayload = {
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
  parentId?: number;
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
  parentId: number | null;
  refs: TaskRef[] | null;
}>;

async function fetchTasks(): Promise<TasksPayload> {
  const res = await fetch('/api/tasks');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// 400s carry the store's "Validation failed: …" reason; keep it so the form can show it.
async function httpError(res: Response): Promise<Error> {
  if (res.status === 400) {
    const body = await res.json().catch(() => null) as { error?: unknown } | null;
    if (typeof body?.error === 'string') return new Error(body.error);
  }
  return new Error(`HTTP ${res.status}`);
}

export function useTasks() {
  const [data, setData] = useState<TasksPayload>({ active: [], done: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSeq = useRef(0);

  const refresh = useCallback(() => {
    const seq = ++fetchSeq.current;
    fetchTasks()
      .then((payload) => {
        if (seq !== fetchSeq.current) return; // a newer fetch is in flight
        setData(payload);
        setError(null);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (seq === fetchSeq.current) setError(err);
      });
  }, []);

  useEffect(() => {
    refresh();

    let es: EventSource | null = null;
    let lastSeen = Date.now();
    let hiddenAt: number | null = null;

    const alive = () => { lastSeen = Date.now(); };
    const onChange = () => { alive(); refresh(); };

    const open = () => {
      es?.close();
      lastSeen = Date.now(); // a stream still connecting must not look stale
      es = new EventSource('/api/tasks/stream');
      es.addEventListener('tasks-changed', onChange);
      es.addEventListener('connected', onChange); // re-fetch after reconnect to catch missed events
      es.addEventListener('ping', alive);
    };

    const reopenIfClosed = () => {
      if (es?.readyState === EventSource.CLOSED) open();
    };

    const onVisibility = () => {
      const now = Date.now();
      if (document.visibilityState === 'hidden') {
        hiddenAt = now;
        return;
      }
      if (es?.readyState === EventSource.CLOSED || isStreamStale(lastSeen, now)) open();
      else if (shouldRefetchOnReturn(hiddenAt, now)) refresh();
      hiddenAt = null;
    };

    open();
    const watchdog = setInterval(() => {
      if (document.visibilityState === 'visible' && isStreamStale(lastSeen, Date.now())) open();
    }, WATCHDOG_INTERVAL_MS);

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', reopenIfClosed);
    window.addEventListener('online', reopenIfClosed);

    return () => {
      es?.close();
      clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', reopenIfClosed);
      window.removeEventListener('online', reopenIfClosed);
    };
  }, [refresh]);

  const add = useCallback(async (body: NewTaskInput): Promise<number> => {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await httpError(res);
    const json = await res.json() as { id: number };
    return json.id;
  }, []);

  const update = useCallback(async (id: number, patch: TaskPatch) => {
    const res = await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw await httpError(res);
  }, []);

  const remove = useCallback(async (id: number) => {
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }, []);

  return { data, loading, error, refresh, add, update, remove };
}

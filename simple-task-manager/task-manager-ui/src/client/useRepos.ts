import { useState, useEffect, useCallback } from 'react';
import type { Contract, RepoCommands, RepoEntry } from '@/types/task';

export type Registry = { repos: RepoEntry[]; contracts: Contract[] };

const EMPTY: Registry = { repos: [], contracts: [] };

export type RepoBody = { folder?: string; name?: string; role?: string; commands?: RepoCommands; rulesFile?: string };
export type ContractBody = { owner?: string; source?: string; consumers?: string[]; rule?: string };

// 400s carry the store's "Validation failed: …" reason, shown verbatim in a toast.
async function writeError(res: Response): Promise<Error> {
  if (res.status === 400) {
    const body = await res.json().catch(() => null) as { error?: unknown } | null;
    if (typeof body?.error === 'string') return new Error(body.error);
  }
  return new Error(`HTTP ${res.status}`);
}

const base = (project: string) => `/api/projects/${encodeURIComponent(project)}`;

async function send(url: string, method: 'PUT' | 'DELETE', body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!res.ok) throw await writeError(res);
}

// `version` changes whenever the task data refetches (every write broadcasts tasks-changed),
// so the registry stays current without its own stream.
export function useRepos(project: string | null, version?: unknown) {
  const [state, setState] = useState<{ project: string | null; registry: Registry }>({ project: null, registry: EMPTY });

  useEffect(() => {
    if (project === null) return;
    let cancelled = false;
    fetch(`${base(project)}/repos`)
      .then((r) => (r.ok ? r.json() as Promise<Registry> : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((registry) => { if (!cancelled) setState({ project, registry }); })
      // Keep the last good registry on a transient refetch failure; only another project's is dropped.
      .catch(() => { if (!cancelled) setState((s) => (s.project === project ? s : { project, registry: EMPTY })); });
    return () => { cancelled = true; };
  }, [project, version]);

  // Another project's registry must never leak into this one while its fetch is in flight.
  const registry = state.project === project ? state.registry : EMPTY;

  const setRepo = useCallback(
    (id: string, body: RepoBody) => send(`${base(project ?? '')}/repos/${encodeURIComponent(id)}`, 'PUT', body),
    [project],
  );
  const deleteRepo = useCallback(
    (id: string) => send(`${base(project ?? '')}/repos/${encodeURIComponent(id)}`, 'DELETE'),
    [project],
  );
  const setContract = useCallback(
    (name: string, body: ContractBody) => send(`${base(project ?? '')}/contracts/${encodeURIComponent(name)}`, 'PUT', body),
    [project],
  );
  const deleteContract = useCallback(
    (name: string) => send(`${base(project ?? '')}/contracts/${encodeURIComponent(name)}`, 'DELETE'),
    [project],
  );

  return { ...registry, setRepo, deleteRepo, setContract, deleteContract };
}

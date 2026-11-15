// Imports the MCP's tasks store directly from the parent package. Migrations
// run on first open inside createStore() — no vendor mirror, no EXPECTED_MIGRATIONS
// validation. When the MCP and the UI both open the same DB, whichever opens
// first applies pending migrations; the other sees the migrated schema.
import {
  createStore, StaleSchemaError,
  type AddInput, type UpdatePatch, type LoadResult, type ProjectEntry, type ProjectSettings, type ApiKey, type EpicChild, type Store,
  type RepoRegistry, type RepoInput, type RepoEntry, type ContractInput, type Contract,
} from '../../../tasks.js';
import type { TaskStatus } from '@/types/task';

export type { AddInput, UpdatePatch, LoadResult, ProjectEntry, ProjectSettings, ApiKey, EpicChild, RepoRegistry, RepoInput, RepoEntry, ContractInput, Contract };

export type TaskStoreOptions = { dbPath: string };

export function createTaskStore({ dbPath }: TaskStoreOptions) {
  const store: Store = createStore(dbPath);

  function load(): LoadResult {
    return store.load();
  }

  function loadWithNotes(): LoadResult {
    return store.loadWithNotes();
  }

  async function add(input: AddInput): Promise<number> {
    return store.add(input).id;
  }

  async function setStatus(id: number, status: TaskStatus): Promise<boolean> {
    return store.setStatus(id, status);
  }

  async function updateTask(id: number, patch: UpdatePatch): Promise<boolean> {
    return store.update(id, patch) !== null;
  }

  async function deleteTask(id: number): Promise<boolean> {
    return store.delete(id);
  }

  async function reorder(epicId: number, order: (number | number[])[]): Promise<EpicChild[]> {
    return store.reorder(epicId, order);
  }

  function getProjects(): ProjectEntry[] {
    return store.getProjects();
  }

  async function createProject(name: string, description?: string): Promise<{ id: string; name: string; description: string }> {
    return store.createProject(name, description);
  }

  async function updateProject(id: string, settings: ProjectSettings): Promise<{ id: string; name: string; description: string; trackPrs: boolean }> {
    return store.updateProject(id, settings);
  }

  function getRepos(project: string): RepoRegistry {
    return store.getRepos(project);
  }

  async function setRepo(project: string, entry: RepoInput): Promise<RepoEntry> {
    return store.setRepo(project, entry);
  }

  async function deleteRepo(project: string, id: string): Promise<boolean> {
    return store.deleteRepo(project, id);
  }

  async function setContract(project: string, contract: ContractInput): Promise<Contract> {
    return store.setContract(project, contract);
  }

  async function deleteContract(project: string, name: string): Promise<boolean> {
    return store.deleteContract(project, name);
  }

  function listApiKeys(): ApiKey[] {
    return store.listApiKeys();
  }

  async function createApiKey(label: string, project: string): Promise<{ id: number; label: string; project: string; key: string }> {
    return store.createApiKey(label, project);
  }

  async function revokeApiKey(id: number): Promise<ApiKey | null> {
    return store.revokeApiKey(id);
  }

  function dataVersion(): number {
    return store.dataVersion();
  }

  function close(): void {
    store.close();
  }

  return {
    load, loadWithNotes, add, setStatus, updateTask, deleteTask, reorder, getProjects, createProject, updateProject,
    getRepos, setRepo, deleteRepo, setContract, deleteContract,
    listApiKeys, createApiKey, revokeApiKey, dataVersion, close,
  };
}

export type TaskStore = ReturnType<typeof createTaskStore>;

// The MCP's tasks.ts throws plain `Error('Validation failed: …')` for bad input.
// We classify here so the HTTP layer can return 400 vs 500.
export function isValidationError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('Validation failed');
}

// Another process migrated the DB past this build: writes are refused until
// the UI is rebuilt/restarted (409, so the client shows the message).
export function isStaleSchemaError(err: unknown): boolean {
  return err instanceof StaleSchemaError;
}

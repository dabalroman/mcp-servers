// Imports the MCP's tasks store directly from the parent package. Migrations
// run on first open inside createStore() — no vendor mirror, no EXPECTED_MIGRATIONS
// validation. When the MCP and the UI both open the same DB, whichever opens
// first applies pending migrations; the other sees the migrated schema.
import { createStore, type AddInput, type UpdatePatch, type LoadResult, type Store } from '../../../tasks.js';
import type { TaskStatus } from '@/types/task';

export type { AddInput, UpdatePatch, LoadResult };

export type TaskStoreOptions = { dbPath: string };

export function createTaskStore({ dbPath }: TaskStoreOptions) {
  const store: Store = createStore(dbPath);

  function load(): LoadResult {
    return store.load();
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

  function dataVersion(): number {
    return store.dataVersion();
  }

  function close(): void {
    store.close();
  }

  return { load, add, setStatus, updateTask, deleteTask, dataVersion, close };
}

export type TaskStore = ReturnType<typeof createTaskStore>;

// The MCP's tasks.ts throws plain `Error('Validation failed: …')` for bad input.
// We classify here so the HTTP layer can return 400 vs 500.
export function isValidationError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('Validation failed');
}

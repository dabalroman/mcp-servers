import { z } from 'zod';
import * as net from 'node:net';
import { RELATIONS, unknownProjectMessage, type Relation, type Task, type Store } from '../tasks.js';

export type MCPContent = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

export const text = (obj: unknown): MCPContent => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });
export const errorText = (obj: unknown): MCPContent => ({ content: [{ type: 'text', text: JSON.stringify(obj) }], isError: true });

// Token-saving for list responses: when a task has a summary, the full description
// adds noise without value. Agents that need the body call getById.
// plan is always stripped from list responses regardless of summary — plans can be
// long markdown documents and are only needed during /implement (use getById).
// notes, epic and children are stripped too (lists carry noteCount and
// parentId/epicTitle); the store never attaches them to list reads, this is a
// guard against leaking bodies.
type ListOmit = 'plan' | 'notes' | 'epic' | 'children';
export function toListTask<T extends Task>(task: T): Omit<T, ListOmit> | Omit<T, ListOmit | 'description'> {
  const { plan: _plan, notes: _notes, epic: _epic, children: _children, ...withoutPlan } = task;
  if (!withoutPlan.summary) return withoutPlan as Omit<T, ListOmit>;
  const { description: _desc, ...rest } = withoutPlan;
  return rest as Omit<T, ListOmit | 'description'>;
}

// Per-connection state. stdio has one per process; #361's HTTP transport will
// build one per session.
export type SessionContext = { project: string };

// Explicit `project` arg wins over the session's bound project. Unknown names
// are an error, never auto-created.
export function resolveProject(store: Store, ctx: SessionContext, argProject?: string): string | MCPContent {
  const explicit = argProject?.trim();
  const name = explicit || ctx.project;
  if (store.hasProject(name)) return name;
  const hint = explicit ? '' : ' This is the session\'s bound project (PROJECT_NAME); pass `project` to use another one.';
  return errorText({ error: `${capitalise(unknownProjectMessage(name))}${hint}` });
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function allIdsSorted(store: Store): number[] {
  const { active, done } = store.load();
  return [...active.map((t) => t.id), ...done.map((t) => t.id)].sort((a, b) => a - b);
}

export function notFoundError(id: number, store: Store, { withAre = false }: { withAre?: boolean } = {}): MCPContent {
  const verb = withAre ? 'Valid IDs are' : 'Valid IDs';
  return errorText({ error: `Task #${id} not found. ${verb}: ${allIdsSorted(store).join(', ') || 'none'}` });
}

export function probeTcp(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
    socket.connect(port, '127.0.0.1');
  });
}

export const projectParam = z.string().min(1).optional()
  .describe("Project to work in. Defaults to this session's project (PROJECT_NAME). Never invent one — ask the user or call getProjects.");

export const refsSchema = z.array(z.object({
  id: z.number().int().positive(),
  relation: z.enum(RELATIONS as unknown as [Relation, ...Relation[]]).default('relates to'),
})).optional();

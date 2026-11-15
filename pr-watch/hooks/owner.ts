import type { EngineInterface } from 'claude-code'

type Owner = { session: string; at: number }

const PREFIX = 'owner:'
const STALE_MS = 5 * 60_000
const KEEP_MS = 14 * 24 * 3600_000

export const WRITING_TOOLS: ReadonlySet<string> = new Set(['update', 'setStatus', 'add', 'addNote', 'replace'])

const keyOf = (taskId: number): string => `${PREFIX}${taskId}`

async function readOwner($: EngineInterface, taskId: number): Promise<Owner | undefined> {
  const value = await $.store.get(keyOf(taskId))

  return typeof value === 'object' && value !== null ? (value as Owner) : undefined
}

export async function claimTask($: EngineInterface, taskId: number, session: string, now: number): Promise<void> {
  await $.store.set(keyOf(taskId), { session, at: now })
}

// The owner refreshes its claim on every poll; a claim left unrefreshed (its session ended) passes to the next poller.
export async function ownsTask($: EngineInterface, taskId: number, session: string, now: number): Promise<boolean> {
  const owner = await readOwner($, taskId)
  if (owner !== undefined && owner.session !== session && now - owner.at < STALE_MS) return false
  await claimTask($, taskId, session, now)

  return true
}

export async function pruneOwners($: EngineInterface, now: number): Promise<void> {
  for (const key of await $.store.keys()) {
    if (!key.startsWith(PREFIX)) continue
    const owner = (await $.store.get(key)) as Owner | undefined
    if (now - (owner?.at ?? 0) >= KEEP_MS) await $.store.delete(key)
  }
}

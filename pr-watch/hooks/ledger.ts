import type { EngineInterface } from 'claude-code'
import type { PrRef } from './gh.ts'
import type { Ledger, PrEvent } from './poll.ts'

const PREFIX = 'pr:'
const KEEP_DONE_MS = 14 * 24 * 3600_000

// $.store is shared by every session on the machine: the ledger is what keeps two sessions
// watching one PR from reporting an event or writing a status twice.
export const ledgerKey = (pr: PrRef): string => `${PREFIX}${pr.repo}#${pr.number}`

export async function loadLedger($: EngineInterface, key: string): Promise<Ledger | undefined> {
  const value = await $.store.get(key)

  return typeof value === 'object' && value !== null ? (value as Ledger) : undefined
}

// The store has no compare-and-set: re-reading right before the writes narrows the race between sessions.
export async function unseen($: EngineInterface, key: string, ledger: Ledger, events: PrEvent[]): Promise<PrEvent[]> {
  const seen = new Set([...((await loadLedger($, key))?.seen ?? []), ...ledger.seen])

  return events.filter(e => !seen.has(e.key))
}

// Saved only after the task writes succeeded, so a failed write is retried on the next poll.
export async function commit($: EngineInterface, key: string, ledger: Ledger, fresh: PrEvent[]): Promise<void> {
  const stored = await loadLedger($, key)
  const seen = new Set([...(stored?.seen ?? []), ...ledger.seen, ...fresh.map(e => e.key)])
  const kept: Ledger = stored?.phase === 'done' && ledger.phase !== 'done' ? stored : ledger
  await $.store.set(key, { ...kept, seen: [...seen] })
}

export async function pruneLedgers($: EngineInterface, now: number): Promise<void> {
  for (const key of await $.store.keys()) {
    if (!key.startsWith(PREFIX)) continue
    const ledger = await loadLedger($, key)
    if (ledger?.phase === 'done' && now - (ledger.finishedAt ?? 0) >= KEEP_DONE_MS) await $.store.delete(key)
  }
}

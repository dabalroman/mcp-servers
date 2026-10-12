export const REFETCH_AFTER_HIDDEN_MS = 30_000;
export const STALE_AFTER_MS = 45_000;
export const WATCHDOG_INTERVAL_MS = 15_000;

export function shouldRefetchOnReturn(hiddenAt: number | null, now: number): boolean {
  return hiddenAt !== null && now - hiddenAt >= REFETCH_AFTER_HIDDEN_MS;
}

export function isStreamStale(lastSeen: number, now: number): boolean {
  return now - lastSeen >= STALE_AFTER_MS;
}

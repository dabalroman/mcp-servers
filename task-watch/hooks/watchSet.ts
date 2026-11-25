// Copied from pr-watch/hooks/watchSet.ts: both plugins install on their own, so neither imports the other.
export type Json = Record<string, unknown>

export const taskId = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN

  return Number.isInteger(n) && n > 0 ? n : undefined
}

export const parseJson = (text: unknown): Json | undefined => {
  if (typeof text !== 'string') return undefined
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null ? (value as Json) : undefined
  } catch {
    return undefined
  }
}

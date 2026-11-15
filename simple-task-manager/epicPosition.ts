export type Position = 'next' | 'last' | { after: number } | { before: number };

export type Sibling = { id: number; status: string; seq: number | null };

export type Renumbered = { id: number; from: number; to: number };

export type ResolvedPosition = { seq: number; renumbered: Renumbered[] };

const NOT_STARTED = new Set(['refinement', 'plan', 'todo']);

const STEP = 10;

// The sibling id an { after } / { before } position names; undefined for 'next', 'last' or a malformed value.
export const positionRef = (position: Position): number | undefined => {
  const ref = typeof position === 'object' && position !== null ? ('after' in position ? position.after : position.before) : undefined;
  return typeof ref === 'number' ? ref : undefined;
};

// Bounds are exclusive: the new seq lands strictly between lo and hi (hi undefined = open end).
type Bounds = { lo: number; hi?: number };

function boundsFor(siblings: Sibling[], seqs: number[], position: Position, epicId: number): Bounds {
  const last = (): Bounds => ({ lo: seqs.at(-1) ?? 0 });
  const below = (hi: number): Bounds => ({ lo: seqs.filter((s) => s < hi).at(-1) ?? 0, hi });

  if (position === 'last') return last();
  if (position === 'next') {
    const pending = siblings.flatMap((s) => (s.seq !== null && NOT_STARTED.has(s.status) ? [s.seq] : []));
    return pending.length ? below(Math.min(...pending)) : last();
  }
  const ref = positionRef(position);
  if (ref === undefined) throw new Error("Validation failed: position must be 'next', 'last', { after: id } or { before: id }.");
  const sibling = siblings.find((s) => s.id === ref);
  if (!sibling) throw new Error(`Validation failed: #${ref} is not a child of epic #${epicId}.`);
  if ('after' in position) {
    if (sibling.seq === null) throw new Error(`Validation failed: #${ref} has no seq, so nothing can sort after it; reorder the epic first.`);
    const lo = sibling.seq;
    return { lo, hi: seqs.find((s) => s > lo) };
  }
  // Every sequenced child already runs before an unset one.
  return sibling.seq === null ? last() : below(sibling.seq);
}

// `siblings` excludes the task being placed. Never joins a parallel group: to join one, pass its seq.
export function resolvePosition(siblings: Sibling[], position: Position, epicId: number): ResolvedPosition {
  const seqs = [...new Set(siblings.flatMap((s) => (s.seq === null ? [] : [s.seq])))].sort((a, b) => a - b);
  const { lo, hi } = boundsFor(siblings, seqs, position, epicId);
  if (hi === undefined) return { seq: lo + STEP, renumbered: [] };
  if (hi - lo >= 2) return { seq: Math.floor((lo + hi) / 2), renumbered: [] };

  // No free integer: spread the groups to 10, 20, 30 (equal seqs stay equal, unset stays unset).
  const to = new Map(seqs.map((seq, i) => [seq, (i + 1) * STEP]));
  const renumbered = siblings.flatMap((s) =>
    s.seq !== null && to.get(s.seq) !== s.seq ? [{ id: s.id, from: s.seq, to: to.get(s.seq)! }] : []);
  const newLo = lo === 0 ? 0 : to.get(lo)!;
  const newHi = to.get(hi)!;
  return { seq: Math.floor((newLo + newHi) / 2), renumbered };
}

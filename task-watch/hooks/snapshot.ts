import type { Snapshot, Watch } from '../types'
import type { Json } from './watchSet.ts'
import { taskId } from './watchSet.ts'

export type Change = { short: string; line: string; turn: boolean }

const NOTE_LIMIT = 1000
const UPDATE_FIELDS = ['title', 'priority', 'summary', 'parentId', 'refs', 'prs'] as const
const EPIC_MOVED = /^Epic #(\d+) .* moved to (\w+)\.$/

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

const listOf = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : [])

function notesOf(value: unknown): Record<string, string> {
  const notes: Record<string, string> = {}
  for (const note of listOf(value)) {
    const id = taskId(note.id)
    if (id !== undefined) notes[id] = text(note.updated_at)
  }

  return notes
}

export const snapshotOf = (task: Json): Snapshot => ({
  title: text(task.title),
  status: text(task.status),
  priority: text(task.priority),
  summary: text(task.summary),
  parentId: taskId(task.parentId) ?? null,
  refs: listOf(task.refs).map(r => `${text(r.relation)} #${String(r.id)}`).sort(),
  prs: JSON.stringify(listOf(task.prs).map(p => [p.url, p.status])),
  updatedAt: text(task.updated_at),
  notes: notesOf(task.notes),
  ownTouch: false,
})

export const groupEpicOf = (task: Json): number | null =>
  task.type === 'epic' ? (taskId(task.id) ?? null) : (taskId(task.parentId) ?? null)

const clip = (id: number, body: string): string =>
  body.length > NOTE_LIMIT ? `${body.slice(0, NOTE_LIMIT)} (truncated, getById #${id})` : body

const epicLabel = (id: number | null): string => (id === null ? 'none' : `#${id}`)

// task is getUpdates' list shape: its notes are only those added or edited since the cursor.
export function diffTask(id: number, before: Snapshot, task: Json): { changes: Change[]; after: Snapshot } {
  const now = snapshotOf(task)
  const changes: Change[] = []
  const later = (short: string, line = short): void => void changes.push({ short, line, turn: false })

  if (now.status !== before.status) {
    const line = `status ${before.status} -> ${now.status}`
    changes.push({ short: line, line, turn: true })
  }
  const notes = { ...before.notes }
  for (const note of listOf(task.notes)) {
    const noteId = taskId(note.id)
    const stamp = text(note.updated_at)
    if (noteId === undefined || notes[noteId] === stamp) continue
    const kind = notes[noteId] === undefined ? 'new note' : 'note edited'
    notes[noteId] = stamp
    changes.push({ short: kind, line: `${kind}: ${clip(id, text(note.body))}`, turn: true })
  }
  if (now.title !== before.title) later(`title "${before.title}" -> "${now.title}"`)
  if (now.priority !== before.priority) later(`priority ${before.priority} -> ${now.priority}`)
  if (now.summary !== before.summary) later('summary edited', `summary now: ${now.summary || '(none)'}`)
  if (now.parentId !== before.parentId) later(`epic ${epicLabel(before.parentId)} -> ${epicLabel(now.parentId)}`)
  if (now.refs.join('\n') !== before.refs.join('\n')) {
    later('refs changed', `refs now: ${now.refs.join(', ') || '(none)'}`)
  }
  const isUnexplained = changes.length === 0 && now.updatedAt !== before.updatedAt && now.prs === before.prs
  if (isUnexplained && !before.ownTouch) later('description or plan edited')

  return { changes, after: { ...now, notes, ownTouch: before.ownTouch && now.updatedAt === before.updatedAt } }
}

export function findTask(watch: Watch, id: number): Snapshot | undefined {
  for (const group of watch.groups) {
    const snapshot = group.tasks[id]
    if (snapshot !== undefined) return snapshot
  }

  return undefined
}

export function findNote(watch: Watch, noteId: number): [number, Snapshot] | undefined {
  for (const group of watch.groups) {
    for (const [id, snapshot] of Object.entries(group.tasks)) if (noteId in snapshot.notes) return [Number(id), snapshot]
  }

  return undefined
}

// The agent's own write goes into the snapshot field by field; the server's echo of fields the call
// did not set is never taken, so a foreign edit to them still diffs on the next poll.
export function applyOwnWrite(watch: Watch, tool: string, input: Json, result: Json): number[] {
  const id = taskId(input.id) ?? taskId(input.taskId)
  const snapshot = id === undefined ? undefined : findTask(watch, id)
  const note = (result.note ?? {}) as Json
  switch (tool) {
    case 'setStatus': {
      if (snapshot !== undefined) Object.assign(snapshot, { status: text(input.status), ownTouch: true })
      const moved = EPIC_MOVED.exec(text(result.epicStatus))
      const epic = moved === null ? undefined : findTask(watch, Number(moved[1]))
      if (epic !== undefined) Object.assign(epic, { status: moved![2], ownTouch: true })
      return [id, epic === undefined ? undefined : Number(moved![1])].flatMap(n => n ?? [])
    }
    case 'update': {
      if (snapshot === undefined) return []
      const echo = snapshotOf((result.task ?? {}) as Json)
      for (const key of UPDATE_FIELDS) if (key in input) Object.assign(snapshot, { [key]: echo[key] })
      snapshot.updatedAt = echo.updatedAt
      return [id!]
    }
    case 'replace':
      if (snapshot === undefined) return []
      snapshot.ownTouch = true
      return [id!]
    case 'addNote': {
      const noteId = taskId(note.id)
      if (snapshot === undefined || noteId === undefined) return []
      snapshot.notes[noteId] = text(note.updated_at)
      snapshot.ownTouch = true
      return [id!]
    }
    case 'updateNote':
    case 'deleteNote': {
      const noteId = taskId(input.noteId)
      const found = noteId === undefined ? undefined : findNote(watch, noteId)
      if (found === undefined) return []
      const [owner, notes] = [found[0], found[1].notes]
      if (tool === 'updateNote') notes[noteId!] = text(note.updated_at)
      else delete notes[noteId!]
      found[1].ownTouch = true
      return [owner]
    }
    case 'delete':
      for (const group of watch.groups) if (id !== undefined) delete group.tasks[id]
      return id === undefined ? [] : [id]
    default:
      return []
  }
}

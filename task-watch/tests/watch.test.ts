import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

type Note = { id: number; task_id: number; body: string; created_at: string; updated_at: string }
type Task = {
  id: number
  title: string
  type: string
  status: string
  priority: string
  parentId?: number
  prs: unknown[]
  notes: Note[]
  updated_at: string
}

const NOW = Date.parse('2026-01-01T12:00:00Z')
const HEAD = 'task-watch: another session or the UI changed tasks this session works on'
const answer = (value: unknown) => ({ value: { content: [{ type: 'text' as const, text: JSON.stringify(value) }], isError: false } })
const task = (id: number, title: string, extra: Partial<Task> = {}): Task => ({
  id,
  title,
  type: 'feature',
  status: 'refinement',
  priority: 'medium',
  prs: [],
  notes: [],
  updated_at: '2026-01-01 11:00:00',
  ...extra,
})

// Stands for the task-manager server: the agent's calls come as tool.call, the plugin's as mcp.call.
function world(on: On, tasks: Task[]) {
  let second = 0
  const clock = () => `2026-01-01 12:00:${String(second).padStart(2, '0')}`
  const byId = new Map(tasks.map(t => [t.id, t]))
  const toasts: string[] = []
  const submitted: { text: string; context: readonly string[] }[] = []

  const write = (id: number, patch: Partial<Task>): Task => {
    second += 1
    return Object.assign(byId.get(id)!, patch, { updated_at: clock() })
  }
  const addNote = (taskId: number, body: string): Note => {
    const t = write(taskId, {})
    const note = { id: 100 + second, task_id: taskId, body, created_at: t.updated_at, updated_at: t.updated_at }
    t.notes.push(note)
    return note
  }
  const full = (t: Task) => ({ ...t, ...(t.type === 'epic' ? { children: tasks.filter(c => c.parentId === t.id).map(c => ({ id: c.id })) } : {}) })
  const listShape = ({ notes, ...t }: Task, since: string) => {
    const recent = notes.filter(n => n.updated_at >= since)
    return { ...t, noteCount: notes.length, ...(recent.length > 0 ? { notes: recent } : {}) }
  }

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_, e) => {
    submitted.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text }
  })
  on('tool.call', (_, e) => {
    const a = e as unknown as Record<string, unknown>
    const id = Number(a.id ?? a.taskId)
    const reply = (value: unknown) => ({ result: {}, text: JSON.stringify(value) })
    switch (String(e.tool).replace('mcp__task-manager__', '')) {
      case 'getById':
        return reply({ task: full(byId.get(id)!) })
      case 'setStatus':
        write(id, { status: String(a.status) })
        return reply({ success: true })
      case 'update': {
        const { notes: _notes, ...echo } = write(id, a.priority === undefined ? {} : { priority: String(a.priority) })
        return reply({ success: true, task: echo })
      }
      case 'addNote':
        return reply({ success: true, note: addNote(id, String(a.body)) })
      default:
        return reply({ error: 'unexpected' })
    }
  })
  on('mcp.call', (_, e) => {
    const a = e.args
    if (e.tool === 'getById') return answer({ task: full(byId.get(Number(a.id))!) })
    const since = String(a.since)
    const ids = (a.ids ?? []) as number[]
    const requested = [...ids, ...(a.epicId === undefined ? [] : [Number(a.epicId)])]
    const found = [...byId.values()].filter(t => t.updated_at >= since && (requested.includes(t.id) || t.parentId === a.epicId))
    found.sort((x, y) => x.updated_at.localeCompare(y.updated_at))
    const missing = requested.filter(n => !byId.has(n))
    return answer({ asOf: clock(), tasks: found.map(t => listShape(t, since)), ...(missing.length > 0 ? { missing } : {}) })
  })

  return { toasts, submitted, foreign: { write, addNote, remove: (id: number) => byId.delete(id) } }
}

async function start($: Engine, on: On) {
  const clock = mock.clock(on, { now: NOW })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  return { poll: () => clock.advance(60_000) }
}

test('own writes start no turn and show no toast', async ($, on) => {
  const w = world(on, [task(1, 'Example')])
  const { poll } = await start($, on)
  await $.tool.call({ tool: 'mcp__task-manager__getById', id: 1 })
  await $.tool.call({ tool: 'mcp__task-manager__setStatus', id: 1, status: 'todo' })
  await $.tool.call({ tool: 'mcp__task-manager__addNote', taskId: 1, body: 'Own note' })
  await poll()

  expect(w.toasts).toEqual([])
  expect(w.submitted).toEqual([])
})

test('a foreign edit right after an own write is still reported', async ($, on) => {
  const w = world(on, [task(1, 'Example')])
  const { poll } = await start($, on)
  await $.tool.call({ tool: 'mcp__task-manager__getById', id: 1 })
  await $.tool.call({ tool: 'mcp__task-manager__update', id: 1, priority: 'high' })
  w.foreign.write(1, { status: 'todo' })
  await poll()

  expect(w.toasts).toEqual(['#1 Example: status refinement -> todo'])
  expect(w.submitted.map(s => s.text)).toEqual([`${HEAD}:\n- #1 Example: status refinement -> todo`])
})

test('a foreign status change and note in the watched epic start one turn', async ($, on) => {
  const w = world(on, [task(10, 'Epic', { type: 'epic' }), task(11, 'Child', { parentId: 10 })])
  const { poll } = await start($, on)
  await $.tool.call({ tool: 'mcp__task-manager__getById', id: 11 })
  w.foreign.write(11, { status: 'todo' })
  w.foreign.addNote(10, 'Order changed: #11 goes first.')
  await poll()

  expect(w.submitted.map(s => s.text)).toEqual([
    `${HEAD}:\n- #11 Child (epic #10): status refinement -> todo\n- #10 Epic: new note: Order changed: #11 goes first.`,
  ])
})

test('a foreign title change rides on the next prompt as context', async ($, on) => {
  const w = world(on, [task(1, 'Example')])
  const { poll } = await start($, on)
  await $.tool.call({ tool: 'mcp__task-manager__getById', id: 1 })
  w.foreign.write(1, { title: 'Renamed' })
  await poll()
  expect(w.submitted).toEqual([])

  await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
  expect(w.submitted[0]!.context).toEqual([`${HEAD} (no action needed unless it affects the current work):\n- #1 Renamed: title "Example" -> "Renamed"`])
})

test('a change to prs alone is ignored', async ($, on) => {
  const w = world(on, [task(1, 'Example')])
  const { poll } = await start($, on)
  await $.tool.call({ tool: 'mcp__task-manager__getById', id: 1 })
  w.foreign.write(1, { prs: [{ url: 'https://github.com/example-org/example-repo/pull/5', number: 5, status: 'merged' }] })
  await poll()

  expect(w.toasts).toEqual([])
  expect(w.submitted).toEqual([])
})

test('a deleted task is reported once', async ($, on) => {
  const w = world(on, [task(1, 'Example')])
  const { poll } = await start($, on)
  await $.tool.call({ tool: 'mcp__task-manager__getById', id: 1 })
  w.foreign.remove(1)
  await poll()
  await poll()

  expect(w.toasts).toEqual(['#1 Example: deleted'])
})

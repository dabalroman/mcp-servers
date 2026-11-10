import type { EngineInterface, Register } from 'claude-code'
import type { Group, Snapshot, Watch } from '../types'
import type { Change } from './snapshot.ts'
import { applyOwnWrite, diffTask, findNote, findTask, groupEpicOf, snapshotOf } from './snapshot.ts'
import type { Json } from './watchSet.ts'
import { parseJson, taskId, touchedTaskIds } from './watchSet.ts'

const TASK_SERVER = 'task-manager'
const TASK_PREFIX = 'mcp__task-manager__'
const WATCH = { plugin: 'task-watch', key: 'watch' } as const
const POLL_MS = 60_000
const BACKOFF_MS = 10 * 60_000
const FAIL_LIMIT = 6
const WRITE_TOOLS = new Set(['setStatus', 'update', 'replace', 'addNote', 'updateNote', 'deleteNote', 'delete'])
const TURN_HEAD = 'task-watch: another session or the UI changed tasks this session works on:'
const CONTEXT_HEAD = 'task-watch: another session or the UI changed tasks this session works on (no action needed unless it affects the current work):'

type TaskCall = (tool: string, args: Json) => Promise<Json>

class TaskManagerAbsent extends Error {}

// Module memory is the live watch: every $.state read in one dispatch sees the moment it began,
// so a poll could never see own writes made while it awaited getUpdates. $.state keeps it over reloads.
let memory: Promise<Watch> | undefined
let polling: Set<number> | undefined
// Ids under an own write not yet answered: a poll landing between the server's write and
// applyOwnWrite would otherwise report that write as foreign.
const writing = new Map<number, number>()
let running = false
let fails = 0
let isLoud = false
let nextAt = 0

const load = ($: EngineInterface): Promise<Watch> =>
  (memory ??= $.state.get(WATCH).then(
    ({ value }) => value ?? { groups: [], pending: [] },
    () => ({ groups: [], pending: [] }),
  ))

const save = async ($: EngineInterface, watch: Watch): Promise<void> => {
  await $.state.set(WATCH, JSON.parse(JSON.stringify(watch)) as Watch)
}

const taskCall =
  ($: EngineInterface): TaskCall =>
  async (tool, args) => {
    const result = await $.mcp.call(TASK_SERVER, tool, args).catch(() => {
      throw new TaskManagerAbsent()
    })
    const block = result.content.find(b => b.type === 'text')
    const answer = block?.type === 'text' ? parseJson(block.text) : undefined
    if (result.isError || answer === undefined || answer.error !== undefined) {
      throw new Error(`task-manager ${tool}: ${String(answer?.error ?? 'failed')}`)
    }

    return answer
  }

const fetchTask = async (call: TaskCall, id: number): Promise<Json | undefined> =>
  (await call('getById', { id }).catch(() => undefined))?.task as Json | undefined

// A task in an epic, or an epic, watches the whole epic as one getUpdates group.
async function join(watch: Watch, call: TaskCall, task: Json): Promise<void> {
  const id = taskId(task.id)
  if (id === undefined || findTask(watch, id) !== undefined) return
  const epicId = groupEpicOf(task)
  const members = new Map<number, Json>([[id, task]])
  if (epicId !== null && !watch.groups.some(g => g.epicId === epicId)) {
    const epic = epicId === id ? task : await fetchTask(call, epicId)
    if (epic !== undefined) members.set(epicId, epic)
    for (const child of Array.isArray(epic?.children) ? (epic.children as Json[]) : []) {
      const childId = taskId(child.id)
      if (childId === undefined || members.has(childId)) continue
      const full = await fetchTask(call, childId)
      if (full !== undefined) members.set(childId, full)
    }
  }
  let group = watch.groups.find(g => g.epicId === epicId)
  if (group === undefined) {
    const stamps = [...members.values()].map(m => String(m.updated_at ?? '')).filter(Boolean).sort()
    group = { epicId, cursor: stamps[0] ?? '1970-01-01 00:00:00', tasks: {} }
    watch.groups.push(group)
  }
  for (const [memberId, member] of members) {
    if (findTask(watch, memberId) === undefined) group.tasks[memberId] = snapshotOf(member)
  }
}

const labelOf = (id: number, s: Snapshot): string =>
  `#${id} ${s.title}${s.parentId === null ? '' : ` (epic #${s.parentId})`}`

type Report = { id: number; snapshot: Snapshot; changes: Change[] }

function pollGroup(watch: Watch, group: Group, answer: Json, skipped: Set<number>, reports: Report[]): void {
  let isComplete = true
  for (const task of Array.isArray(answer.tasks) ? (answer.tasks as Json[]) : []) {
    const id = taskId(task.id)
    if (id === undefined) continue
    if (skipped.has(id) || writing.has(id)) {
      isComplete = false
      continue
    }
    const before = findTask(watch, id)
    if (before === undefined) {
      group.tasks[id] = snapshotOf(task)
      continue
    }
    const { changes, after } = diffTask(id, before, task)
    for (const g of watch.groups) if (id in g.tasks) g.tasks[id] = after
    if (changes.length > 0) reports.push({ id, snapshot: after, changes })
  }
  for (const id of Array.isArray(answer.missing) ? (answer.missing as unknown[]).flatMap(n => taskId(n) ?? []) : []) {
    const gone = group.tasks[id]
    if (gone !== undefined) {
      reports.push({ id, snapshot: gone, changes: [{ short: 'deleted', line: 'deleted', turn: false }] })
      delete group.tasks[id]
    }
    if (id === group.epicId) group.epicId = null
  }
  if (isComplete && typeof answer.asOf === 'string') group.cursor = answer.asOf
}

function regroup(watch: Watch): void {
  const loose = watch.groups.filter(g => g.epicId === null)
  const [first, ...rest] = loose
  for (const g of rest) {
    Object.assign(first!.tasks, g.tasks)
    if (g.cursor < first!.cursor) first!.cursor = g.cursor
  }
  watch.groups = watch.groups.filter(g => !rest.includes(g) && Object.keys(g.tasks).length > 0)
}

function deliver($: EngineInterface, watch: Watch, reports: Report[]): void {
  const turn: string[] = []
  for (const { id, snapshot, changes } of reports) {
    $.ui.toast(`#${id} ${snapshot.title}: ${changes.map(c => c.short).join(', ')}`)
    for (const change of changes) (change.turn ? turn : watch.pending).push(`- ${labelOf(id, snapshot)}: ${change.line}`)
  }
  if (turn.length > 0) void $.prompt.submit({ text: [TURN_HEAD, ...turn].join('\n') })
}

async function cycle($: EngineInterface): Promise<void> {
  const watch = await load($)
  if (watch.groups.length === 0) return
  const call = taskCall($)
  const skipped = new Set<number>()
  polling = skipped
  const answers: [Group, Json][] = []
  try {
    for (const group of [...watch.groups]) {
      const ids = Object.keys(group.tasks).map(Number).filter(id => id !== group.epicId)
      const args: Json = { since: group.cursor }
      if (ids.length > 0) args.ids = ids
      if (group.epicId !== null) args.epicId = group.epicId
      answers.push([group, await call('getUpdates', args)])
    }
  } finally {
    polling = undefined
  }
  const reports: Report[] = []
  for (const [group, answer] of answers) if (watch.groups.includes(group)) pollGroup(watch, group, answer, skipped, reports)
  regroup(watch)
  deliver($, watch, reports)
  await save($, watch)
}

async function tick($: EngineInterface): Promise<void> {
  if (running) return
  const now = await $.clock.now()
  if (now < nextAt) return
  running = true
  try {
    await cycle($)
    if (isLoud) $.ui.toast('task-watch recovered')
    fails = 0
    isLoud = false
    nextAt = 0
  } catch (error) {
    // No task-manager in this session: nothing to watch, and nothing to report.
    if (error instanceof TaskManagerAbsent) return
    fails += 1
    if (fails >= FAIL_LIMIT) {
      nextAt = now + BACKOFF_MS
      if (!isLoud) {
        isLoud = true
        $.ui.toast(`task-watch error: ${error instanceof Error ? error.message : String(error)}; retrying every 10 min`)
      }
    }
  } finally {
    running = false
  }
}

async function track($: EngineInterface, tool: string, input: Json, result: Json): Promise<void> {
  const watch = await load($)
  const own = applyOwnWrite(watch, tool, input, result)
  for (const id of own) polling?.add(id)
  const call = taskCall($)
  for (const id of touchedTaskIds(tool, input, result)) {
    if (findTask(watch, id) !== undefined) continue
    const given = result.task as Json | undefined
    const task = tool === 'getById' && taskId(given?.id) === id ? given : await fetchTask(call, id)
    if (task !== undefined) await join(watch, call, task)
  }
  regroup(watch)
  await save($, watch)
}

function writeTargets(watch: Watch, input: Json): number[] {
  const id = taskId(input.id) ?? taskId(input.taskId) ?? findNote(watch, taskId(input.noteId) ?? 0)?.[0]
  const parentId = id === undefined ? null : (findTask(watch, id)?.parentId ?? null)

  return [id, parentId].flatMap(n => n ?? [])
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    $.clock.every(POLL_MS, () => void tick($))

    return started
  })

  on('tool.call', { tool: /^mcp__task-manager__/ }, async ($, e, next) => {
    const tool = String(e.tool).slice(TASK_PREFIX.length)
    const targets = WRITE_TOOLS.has(tool) ? writeTargets(await load($), e as unknown as Json) : []
    for (const id of targets) writing.set(id, (writing.get(id) ?? 0) + 1)
    try {
      const result = await next(e)
      try {
        const answer = parseJson(result.text)
        if (result.deny === undefined && result.isError !== true && answer !== undefined && answer.error === undefined) {
          await track($, tool, e as unknown as Json, answer)
        }
      } catch {
        // Watching must never fail a task call.
      }

      return result
    } finally {
      for (const id of targets) {
        const left = (writing.get(id) ?? 1) - 1
        if (left > 0) writing.set(id, left)
        else writing.delete(id)
      }
    }
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const watch = await load($)
    if (watch.pending.length === 0) return next(e)
    const lines = watch.pending.splice(0)
    const entered = await next({ ...e, context: [...(e.context ?? []), [CONTEXT_HEAD, ...lines].join('\n')] })
    if (entered.drop !== undefined) watch.pending.unshift(...lines)
    await save($, watch)

    return entered
  }).catch(($, e, next) => next(e))
}

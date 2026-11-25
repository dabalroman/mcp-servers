import type { EngineInterface, Register } from 'claude-code'
import type { Group, Snapshot, Watch } from '../types'
import type { Change } from './snapshot.ts'
import { applyOwnWrite, diffTask, findNote, findTask, snapshotOf } from './snapshot.ts'
import type { Json } from './watchSet.ts'
import { parseJson, taskId } from './watchSet.ts'

const TASK_SERVER = 'task-manager'
const TASK_PREFIX = 'mcp__task-manager__'
const WATCH = { plugin: 'task-watch', key: 'watch' } as const
const POLL_MS = 60_000
const BACKOFF_MS = 10 * 60_000
const FAIL_LIMIT = 6
const WRITE_TOOLS = new Set(['setStatus', 'add', 'update', 'replace', 'addNote', 'updateNote', 'deleteNote', 'delete'])
const USAGE = 'Usage: /task-watch [start|stop] #id ... | stop | list'
const ABSENT = 'task-watch needs the task-manager MCP in this session'
const ID = /^#?\d+$/
const WATCH_DESCRIPTION =
  'Watches task-manager tasks for changes made by other sessions or the UI. Start it on the task or epic you are implementing or coordinating (an epic id covers all its children, a child id only that child), never on tasks you only read. stop without ids clears all.'
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

const fresh = (): Watch => ({ optIn: true, groups: [], pending: [] })

const load = ($: EngineInterface): Promise<Watch> =>
  (memory ??= $.state.get(WATCH).then(
    ({ value }) => (value?.optIn === true ? value : fresh()),
    fresh,
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
  (
    await call('getById', { id }).catch((error: unknown) => {
      if (error instanceof TaskManagerAbsent) throw error
      return undefined
    })
  )?.task as Json | undefined

const looseGroup = (watch: Watch, cursor: string): Group => {
  let group = watch.groups.find(g => g.epicId === null)
  if (group === undefined) {
    group = { epicId: null, cursor, tasks: {} }
    watch.groups.push(group)
  }
  if (cursor < group.cursor) group.cursor = cursor

  return group
}

async function watchEpic(watch: Watch, call: TaskCall, epic: Json, id: number): Promise<void> {
  const members = new Map<number, Json>([[id, epic]])
  for (const child of Array.isArray(epic.children) ? (epic.children as Json[]) : []) {
    const childId = taskId(child.id)
    if (childId === undefined) continue
    const full = await fetchTask(call, childId)
    if (full !== undefined) members.set(childId, full)
  }
  const stamps = [...members.values()].map(m => String(m.updated_at ?? '')).filter(Boolean).sort()
  const group: Group = { epicId: id, cursor: stamps[0] ?? '1970-01-01 00:00:00', tasks: {} }
  const loose = watch.groups.find(g => g.epicId === null)
  for (const [memberId, member] of members) {
    const moved = loose?.tasks[memberId]
    group.tasks[memberId] = moved ?? snapshotOf(member)
    if (moved === undefined) continue
    delete loose!.tasks[memberId]
    if (loose!.cursor < group.cursor) group.cursor = loose!.cursor
  }
  watch.groups.push(group)
}

async function startWatching(watch: Watch, call: TaskCall, ids: number[]): Promise<string> {
  const started: string[] = []
  const notes: string[] = []
  for (const id of ids) {
    const task = await fetchTask(call, id)
    if (task === undefined) {
      notes.push(`#${id} skipped (not found)`)
      continue
    }
    const parentId = taskId(task.parentId)
    if (task.type === 'epic') {
      if (!watch.groups.some(g => g.epicId === id)) await watchEpic(watch, call, task, id)
    } else if (parentId !== undefined && watch.groups.some(g => g.epicId === parentId)) {
      notes.push(`#${id} already watched via epic #${parentId}`)
      continue
    } else if (findTask(watch, id) === undefined) {
      looseGroup(watch, String(task.updated_at ?? '1970-01-01 00:00:00')).tasks[id] = snapshotOf(task)
    }
    started.push(`#${id}`)
  }
  regroup(watch)

  return [...(started.length > 0 ? [`Watching ${started.join(', ')}`] : []), ...notes].join('; ')
}

function stopWatching(watch: Watch, ids: number[]): string {
  if (ids.length === 0) {
    watch.groups = []
    watch.pending = []

    return 'Stopped watching everything'
  }
  const stopped: string[] = []
  const notes: string[] = []
  for (const id of ids) {
    const epic = watch.groups.find(g => g.epicId === id)
    const owner = watch.groups.find(g => id in g.tasks)
    if (epic !== undefined) watch.groups = watch.groups.filter(g => g !== epic)
    else if (owner?.epicId === null) delete owner.tasks[id]
    else if (owner !== undefined) {
      notes.push(`#${id} is watched via epic #${owner.epicId}; stop #${owner.epicId}`)
      continue
    } else {
      notes.push(`#${id} was not watched`)
      continue
    }
    stopped.push(`#${id}`)
  }
  regroup(watch)

  return [...(stopped.length > 0 ? [`Stopped ${stopped.join(', ')}`] : []), ...notes].join('; ')
}

function listWatched(watch: Watch): string {
  const lines = watch.groups.flatMap(g =>
    Object.entries(g.tasks)
      .map(([id, s]) => [Number(id), s] as const)
      .sort(([a], [b]) => Number(b === g.epicId) - Number(a === g.epicId) || a - b)
      .map(([id, s]) => labelOf(id, s)),
  )

  return lines.length > 0 ? lines.join('\n') : 'Nothing watched'
}

async function act($: EngineInterface, action: 'start' | 'stop' | 'list', ids: number[]): Promise<string> {
  const watch = await load($)
  try {
    if (action === 'list') return listWatched(watch)
    const reply = action === 'start' ? await startWatching(watch, taskCall($), ids) : stopWatching(watch, ids)
    await save($, watch)

    return reply
  } catch (error) {
    if (error instanceof TaskManagerAbsent) return ABSENT
    throw error
  }
}

function parseCommand(args: string): { action: 'start' | 'stop' | 'list'; ids: number[] } | undefined {
  const tokens = args.split(/\s+/).filter(Boolean)
  const [head = 'list', ...rest] = tokens
  const verb = ID.test(head) ? 'start' : head
  const idTokens = ID.test(head) ? tokens : rest
  if (!idTokens.every(t => ID.test(t))) return undefined
  const ids = idTokens.map(t => Number(t.replace('#', '')))
  if (verb === 'start' && ids.length > 0) return { action: 'start', ids }
  if (verb === 'stop') return { action: 'stop', ids }
  if (verb === 'list' && ids.length === 0) return { action: 'list', ids }

  return undefined
}

async function runTool($: EngineInterface, input: Json): Promise<string> {
  const ids = (Array.isArray(input.ids) ? input.ids : []).flatMap(n => taskId(n) ?? [])
  const { action } = input
  if (action === 'start' && ids.length === 0) return USAGE
  if (action !== 'start' && action !== 'stop' && action !== 'list') return USAGE

  return act($, action, ids)
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
  regroup(watch)
  await save($, watch)
}

function writeTargets(watch: Watch, input: Json): number[] {
  const id = taskId(input.id) ?? taskId(input.taskId) ?? findNote(watch, taskId(input.noteId) ?? 0)?.[0]
  const parentId = id === undefined ? null : (findTask(watch, id)?.parentId ?? null)

  const refIds = (Array.isArray(input.refs) ? (input.refs as Json[]) : []).map(r => taskId(r.id))

  return [id, parentId, ...refIds].flatMap(n => n ?? [])
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'task-watch',
      description: 'Watch task-manager tasks in this session: /task-watch [start|stop] #id ... | stop',
      argumentHint: '[start|stop] #id ... | stop',
    })
    await $.tool.register({
      name: 'watch',
      description: WATCH_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: { action: { enum: ['start', 'stop', 'list'] }, ids: { type: 'array', items: { type: 'integer' } } },
        required: ['action'],
      },
    })
    $.clock.every(POLL_MS, () => void tick($))

    return started
  })

  on('command.run', { command: 'task-watch' }, async ($, e) => {
    const parsed = parseCommand(e.args)

    return { text: parsed === undefined ? USAGE : await act($, parsed.action, parsed.ids) }
  })

  on('tool.run', { tool: 'mcp__task-watch__watch' }, async ($, e) => ({ result: await runTool($, e as unknown as Json) }))

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

import type { EngineInterface, Register } from 'claude-code'
import type { Watch } from '../types'
import type { PrRef } from './gh.ts'
import { ghOf, prRefOf } from './gh.ts'
import { commit, ledgerKey, loadLedger, pruneLedgers, unseen } from './ledger.ts'
import type { TaskLabel } from './messages.ts'
import { errorText, eventLine, promptText, rulesSection, shortLine } from './messages.ts'
import type { PollConfig } from './poll.ts'
import { newLedger, pollPr } from './poll.ts'
import type { TaskCall } from './taskWrites.ts'
import { writeDeployNote, writeStatus } from './taskWrites.ts'
import type { Json } from './watchSet.ts'
import { jiraIdOf, parseJson, taskId, touchedTaskIds } from './watchSet.ts'

const TASK_SERVER = 'task-manager'
const TASK_PREFIX = 'mcp__task-manager__'
const WATCH = { plugin: 'pr-watch', key: 'watch' } as const
const POLL_MS = 60_000
const BACKOFF_MS = 10 * 60_000
const FAIL_LIMIT = 6
const WATCHED: ReadonlySet<string> = new Set(['draft', 'open', 'pipeline_pass', 'approved', 'merged'])

type Config = PollConfig & { followUp: string }
type Watched = { pr: PrRef; task: TaskLabel }

class TaskManagerAbsent extends Error {}

let running = false
let fails = 0
let isLoud = false
let nextAt = 0

const taskCall =
  ($: EngineInterface): TaskCall =>
  async (tool, args) => {
    const result = await $.mcp.call(TASK_SERVER, tool, args)
    const block = result.content.find(b => b.type === 'text')
    const answer = block?.type === 'text' ? parseJson(block.text) : undefined
    if (result.isError || answer === undefined || answer.error !== undefined) {
      throw new Error(`task-manager ${tool}: ${String(answer?.error ?? 'failed')}`)
    }

    return answer
  }

async function readWatch($: EngineInterface): Promise<Watch> {
  return (await $.state.get(WATCH)).value ?? { taskIds: [] }
}

async function addToWatch($: EngineInterface, ids: number[]): Promise<void> {
  const watch = await readWatch($)
  const fresh = ids.filter(id => !watch.taskIds.includes(id))
  if (fresh.length > 0) await $.state.set(WATCH, { taskIds: [...watch.taskIds, ...fresh] })
}

async function branchTaskIds($: EngineInterface, call: TaskCall): Promise<number[]> {
  const branch = await $.process.run(['git', 'branch', '--show-current']).catch(() => undefined)
  const jira = branch?.exitCode === 0 ? jiraIdOf(branch.stdout.trim()) : undefined
  if (jira === undefined) return []
  const answer = await call('getByExternalId', { externalId: jira })

  return Array.isArray(answer.tasks) ? (answer.tasks as Json[]).flatMap(t => taskId(t.id) ?? []) : []
}

// The watch set grows only; an epic brings its children, so their PRs are watched too.
async function watchedPrs($: EngineInterface, call: TaskCall): Promise<Watched[]> {
  let start: number[]
  try {
    start = [...(await readWatch($)).taskIds, ...(await branchTaskIds($, call))]
  } catch {
    throw new TaskManagerAbsent()
  }
  const queue = [...new Set(start)]
  const ids = new Set(queue)
  const prs = new Map<string, Watched>()
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    const task = (await call('getById', { id }).catch(() => undefined))?.task as Json | undefined
    if (task === undefined) continue
    if (Array.isArray(task.children)) {
      for (const child of task.children as Json[]) {
        const childId = taskId(child.id)
        if (childId !== undefined && !ids.has(childId)) {
          ids.add(childId)
          queue.push(childId)
        }
      }
    }
    for (const entry of Array.isArray(task.prs) ? (task.prs as Json[]) : []) {
      const pr = typeof entry.url === 'string' && WATCHED.has(String(entry.status)) ? prRefOf(entry.url) : undefined
      if (pr !== undefined && !prs.has(pr.url)) prs.set(pr.url, { pr, task: { id, title: String(task.title ?? '') } })
    }
  }
  await addToWatch($, [...ids])

  return [...prs.values()]
}

async function watchPr($: EngineInterface, call: TaskCall, cfg: Config, { pr, task }: Watched, lines: string[]): Promise<void> {
  const key = ledgerKey(pr)
  const stored = await loadLedger($, key)
  if (stored?.phase === 'done') return
  const ledger = stored ?? newLedger()
  const now = await $.clock.now()
  const { status, events } = await pollPr(ghOf($), pr, ledger, now, cfg, stored === undefined)
  const fresh = await unseen($, key, ledger, events)

  if (status !== undefined) await writeStatus(call, pr.url, status)
  for (const event of fresh) {
    if (event.note === true && ledger.quiet !== true) await writeDeployNote(call, pr.url, shortLine(pr, event))
  }
  await commit($, key, ledger, fresh)
  for (const event of fresh) {
    if (event.toast === true) $.ui.toast(shortLine(pr, event))
    if (!event.turn || ledger.quiet === true) continue
    lines.push(eventLine(pr, task, event))
  }
}

async function cycle($: EngineInterface, cfg: Config): Promise<void> {
  const call = taskCall($)
  let watched: Watched[]
  try {
    watched = await watchedPrs($, call)
  } catch (error) {
    // No task-manager in this session: nothing to watch, and nothing to report.
    if (error instanceof TaskManagerAbsent) return
    throw error
  }
  const lines: string[] = []
  let failure: string | undefined
  for (const entry of watched) {
    try {
      await watchPr($, call, cfg, entry, lines)
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
  }
  if (lines.length > 0) void $.prompt.submit({ text: promptText(lines) })
  if (failure !== undefined) throw new Error(failure)
}

async function tick($: EngineInterface, cfg: Config): Promise<void> {
  if (running) return
  const now = await $.clock.now()
  if (now < nextAt) return
  running = true
  try {
    await cycle($, cfg)
    if (isLoud) $.ui.toast('pr-watch recovered')
    fails = 0
    isLoud = false
    nextAt = 0
  } catch (error) {
    fails += 1
    if (fails >= FAIL_LIMIT) {
      nextAt = now + BACKOFF_MS
      if (!isLoud) {
        isLoud = true
        const reason = error instanceof Error ? error.message : String(error)
        $.ui.toast(`pr-watch error: ${reason}`)
        void $.prompt.submit({ text: errorText(reason) })
      }
    }
  } finally {
    running = false
  }
}

export const register: Register = (on, options) => {
  const cfg: Config = {
    workflow: typeof options.deployWorkflow === 'string' && options.deployWorkflow !== '' ? options.deployWorkflow : 'deploy-dev.yml',
    followUp: typeof options.deployFollowUp === 'string' ? options.deployFollowUp : '',
  }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try {
      await pruneLedgers($, await $.clock.now())
    } catch {
      // A full or unreadable store only costs the prune.
    }
    $.clock.every(POLL_MS, () => void tick($, cfg))

    return started
  })

  on('tool.call', { tool: /^mcp__task-manager__/ }, async ($, e, next) => {
    const result = await next(e)
    try {
      if (result.deny === undefined && result.isError !== true) {
        const tool = String(e.tool).slice(TASK_PREFIX.length)
        const ids = touchedTaskIds(tool, e as unknown as Json, parseJson(result.text))
        if (ids.length > 0) await addToWatch($, ids)
      }
    } catch {
      // Watching must never fail a task call.
    }

    return result
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return {
      sections: [...composed.sections, { id: 'pr-watch:rules', text: rulesSection(cfg.followUp), scope: 'session' }],
    }
  })
}

import type { EngineInterface, Register, SessionContextUsage, ToolCallResult } from 'claude-code'
import { type Json, parseJson, taskId, touchedTaskIds } from './watchSet.ts'

const TASK_SERVER = 'task-manager'
const TASK_PREFIX = 'mcp__task-manager__'
// The task tools that can move the current task or change how many are open.
const MUTATORS = new Set(['add', 'setStatus', 'delete', 'update'])
// The task-manager UI's own colour for an in-progress task (styles.scss --primary).
const PRIMARY = '#51CDEC'

// What the band draws: the model, the context fill and the task.
type Band = {
  model: string
  context: string
  epic: string | undefined
  phrase: string | undefined
  rest: string | undefined
}

let band: Band = { model: '', context: '', epic: undefined, phrase: undefined, rest: undefined }
let bandKey = ''
type Epic = { id: number; title: string }
let active: { id: number; epic: Epic | undefined } | undefined
// Task ids this session touched, most recent first: only these can be its current task.
let touched: number[] = []
let open: number | undefined
let fetchedAt = 0
let stale = true

const modelName = (id: string): string => id.replace(/^(?:[a-z]+\.)?anthropic\./, '')

const trimmed = (s: string): string => s.replace(/\.0$/, '')

const fmtTokens = (n: number): string =>
  n >= 1_000_000
    ? `${trimmed((n / 1_000_000).toFixed(1))}M`
    : n >= 1_000
      ? `${trimmed((n / 1_000).toFixed(1))}k`
      : `${n}`

// Empty until the live window's first response, and just after a compaction.
const contextPart = (c: SessionContextUsage | undefined): string => {
  if (c === undefined) return ''
  if (c.tokens === undefined) return `${fmtTokens(c.window)} window`
  const percent = c.percent ?? Math.round((100 * c.tokens) / c.window)

  return `${fmtTokens(c.tokens)}/${fmtTokens(c.window)} ${percent}%`
}

const EPIC_TITLE_MAX = 40

const clip = (s: string): string => (s.length > EPIC_TITLE_MAX ? `${s.slice(0, EPIC_TITLE_MAX - 1)}…` : s)

const taskParts = (): Pick<Band, 'epic' | 'phrase' | 'rest'> => {
  const epic = active?.epic === undefined ? undefined : `#${active.epic.id} ${clip(active.epic.title)}`
  const phrase = active === undefined ? undefined : `#${active.id} in_progress`
  const rest = open !== undefined && open > 0 ? `${open} open` : undefined

  return { epic, phrase, rest }
}

const keyOf = (b: Band): string => [b.model, b.context, b.epic ?? '', b.phrase ?? '', b.rest ?? ''].join('\u0000')

// The task-manager MCP is optional: absent or unreachable leaves the band as it was.
async function readTaskTool($: EngineInterface, tool: string, args: Json = {}): Promise<Json | undefined> {
  try {
    const result = await $.mcp.call(TASK_SERVER, tool, args)
    for (const block of result.content) {
      const parsed = block.type === 'text' ? parseJson(block.text) : undefined
      if (parsed !== undefined) return parsed
    }
  } catch {
    return undefined
  }

  return undefined
}

// Not the newest updated_at: other sessions, the UI and pr-watch bump it too.
// An epic follows its children, so it is never the work being shown.
async function seedActive($: EngineInterface): Promise<void> {
  if (touched.length === 0) {
    active = undefined
    return
  }
  const answer = await readTaskTool($, 'getAll', { status: 'in_progress' })
  const groups = answer?.tasks
  active = undefined
  if (typeof groups !== 'object' || groups === null) return
  const inProgress = new Map<number, Json>()
  for (const list of Object.values(groups as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      const task = entry as Json
      const id = taskId(task.id)
      if (id !== undefined && task.type !== 'epic') inProgress.set(id, task)
    }
  }
  const id = touched.find(t => inProgress.has(t))
  if (id === undefined) return
  const task = inProgress.get(id) as Json
  const epicId = taskId(task.parentId)
  const epic =
    epicId !== undefined && typeof task.epicTitle === 'string' ? { id: epicId, title: task.epicTitle } : undefined
  active = { id, epic }
}

async function syncTasks($: EngineInterface, force = false): Promise<void> {
  if (!force && !stale && Date.now() - fetchedAt < 10_000) return
  const answer = await readTaskTool($, 'getOverview')
  fetchedAt = Date.now()
  if (answer === undefined) return
  const entries = answer.overview
  if (!Array.isArray(entries)) return
  let sum = 0
  for (const entry of entries) {
    const n = (entry as Json).open
    if (typeof n === 'number') sum += n
  }
  open = sum
  stale = false
}

async function refresh($: EngineInterface): Promise<void> {
  const model = await $.session.model()
  let context: SessionContextUsage | undefined
  try {
    context = (await $.session.usage()).context
  } catch {
    context = undefined
  }

  const next: Band = { model: modelName(model), context: contextPart(context), ...taskParts() }
  const key = keyOf(next)
  band = next
  // The band reads this module's state, so a change asks the engine to draw it.
  if (key !== bandKey) {
    bandKey = key
    $.ui.invalidate('ui.render')
  }
}

const observe = async ($: EngineInterface, tool: string, input: Json, result: ToolCallResult): Promise<void> => {
  if (result.deny !== undefined || result.isError === true) return
  const name = tool.startsWith(TASK_PREFIX) ? tool.slice(TASK_PREFIX.length) : ''
  const answer = parseJson(result.text)
  if (answer !== undefined && answer.error !== undefined) return
  const ids = touchedTaskIds(name, input, answer)
  const mutated = MUTATORS.has(name)
  const next = [...ids, ...touched.filter(t => !ids.includes(t))]
  if (!mutated && next.join() === touched.join()) return
  touched = next

  if (mutated) stale = true
  // Any status move or delete can change which tasks are in progress, so re-read
  // the set rather than guessing from the one call.
  await seedActive($)
  await syncTasks($)
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A line the previous load pinned is cleared: the band carries it now.
    $.ui.status(undefined)
    await syncTasks($, true)
    await refresh($)
    // No model-change event and no per-step measure: poll the free figure so
    // both a `/model` switch and context growth mid-turn show within seconds.
    $.clock.every(2000, () => refresh($))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    await syncTasks($)
    await refresh($)

    return measured
  })

  // The model already calls these tools on its own: the band follows the task
  // lifecycle without the model knowing the plugin exists.
  on('tool.call', { tool: /^mcp__task-manager__/ }, async ($, e, next) => {
    const result = await next(e)
    try {
      await observe($, String(e.tool), e as unknown as Json, result)
    } catch {
      // The band must never fail a task call.
    }

    return result
  }).catch(($, e, next) => next(e))

  // A status line is plain text, so the colour needs a surface that draws: the
  // band above the prompt takes the task-manager UI's own colour for the task.
  // One Text holds the line, the phrase nested, so the band draws one row.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = band
    if (drawn.model === '' || e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // The band is one instance for every plugin: keep what the plugins beneath draw.
    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Text dimColor>
          {drawn.model}
          {drawn.context === '' ? '' : ` · ${drawn.context}`}
          {drawn.epic === undefined ? '' : ` · ${drawn.epic}`}
          {drawn.phrase === undefined ? '' : drawn.epic === undefined ? ' · ' : ' › '}
          {drawn.phrase === undefined ? null : (
            <Text color={PRIMARY} bold>
              {drawn.phrase}
            </Text>
          )}
          {drawn.rest === undefined ? '' : ` · ${drawn.rest}`}
        </Text>
        {below}
      </Box>
    )
  })
}

import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'

type Row = { id: number; type: string; updated_at: string; parentId?: number; epicTitle?: string }

type State = { open: number; rows: Row[] }

const answer = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false })

const BAND_PROPS = {
  hasSurvey: false,
  isCollapsed: false,
  isWorking: false,
  maxRows: 5,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 4 },
  view: {},
} as const

const mountBand = ($: Engine) =>
  $.ui.mount({ plugin: 'active-model', component: 'AbovePrompt', props: BAND_PROPS, surface: 'terminal' })

// The plugin under test is loaded by the kit; these hooks stand for the engine.
const harness = (on: On, lines: (string | undefined)[], state: () => State) => {
  const invalidations: number[] = []
  on('ui.status', (_, e) => {
    lines.push(e.text)

    return { value: undefined }
  })
  on('ui.invalidate', () => {
    invalidations.push(invalidations.length)

    return { value: undefined }
  })
  on('session.model', () => ({ value: 'us.anthropic.test-model' }))
  on('session.usage', () => ({
    value: { startedAt: 0, rateLimits: [], context: { tokens: 24_300, window: 400_000, percent: 6 } },
  }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('mcp.call', (_, e) => {
    const { open, rows } = state()

    return e.tool === 'getOverview'
      ? { value: answer({ overview: [{ type: 'feature', open }] }) }
      : { value: answer({ tasks: { feature: rows } }) }
  })

  return invalidations
}

const answerTaskCalls = (on: On) =>
  on('tool.call', (_, e) => ({ result: {}, text: JSON.stringify({ task: { id: e.id } }), isReadOnly: true }))

const touch = ($: Engine, id: number) => $.tool.call({ tool: 'mcp__task-manager__getById', id })

test('the band carries the model, the context fill and the task in its colour', async ($, on) => {
  const lines: (string | undefined)[] = []
  harness(on, lines, () => ({ open: 2, rows: [{ id: 7, type: 'feature', updated_at: '2026-01-01 10:00:00' }] }))
  answerTaskCalls(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  await touch($, 7)

  // Nothing is pinned under the prompt: the band carries it all.
  expect(lines).toEqual([undefined])

  const ui = await mountBand($)
  expect((await ui.find({ type: 'Text', text: 'test-model' }))?.text).toBe(
    'test-model · 24.3k/400k 6% · #7 in_progress · 2 open',
  )
  const phrase = (await ui.findAll({ type: 'Text' })).find(entry => entry.text === '#7 in_progress')
  expect(phrase?.props.color).toBe('#51CDEC')
  await ui.unmount()
})

test('a task mutation redraws the band', async ($, on) => {
  const lines: (string | undefined)[] = []
  let open = 2
  const rows = [{ id: 7, type: 'feature', updated_at: '2026-01-01 10:00:00' }]
  harness(on, lines, () => ({ open, rows }))
  on('tool.call', () => ({ result: {}, text: JSON.stringify({ success: true }), isReadOnly: true }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  open = 3
  await $.tool.call({ tool: 'mcp__task-manager__add', type: 'feature', title: 'x', priority: 'low' })

  const ui = await mountBand($)
  expect((await ui.find({ type: 'Text', text: 'test-model' }))?.text).toBe(
    'test-model · 24.3k/400k 6% · 3 open',
  )
  await ui.unmount()
})

test('only a task this session touched is shown, not the newest in progress', async ($, on) => {
  const lines: (string | undefined)[] = []
  harness(on, lines, () => ({
    open: 4,
    rows: [
      { id: 7, type: 'feature', updated_at: '2026-01-01 10:00:00' },
      { id: 8, type: 'tool', updated_at: '2026-01-02 10:00:00' },
      { id: 9, type: 'epic', updated_at: '2026-01-03 10:00:00' },
    ],
  }))
  answerTaskCalls(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  const before = await mountBand($)
  expect((await before.find({ type: 'Text', text: 'test-model' }))?.text).toBe('test-model · 24.3k/400k 6% · 4 open')
  await before.unmount()

  await touch($, 7)
  await touch($, 9)
  const ui = await mountBand($)
  expect((await ui.find({ type: 'Text', text: 'test-model' }))?.text).toBe(
    'test-model · 24.3k/400k 6% · #7 in_progress · 4 open',
  )
  await ui.unmount()
})

test('a task in an epic shows the epic before it, a long title clipped', async ($, on) => {
  const lines: (string | undefined)[] = []
  const epicTitle = 'Rebuild the data model so every task carries its epic context'
  harness(on, lines, () => ({
    open: 2,
    rows: [{ id: 8, type: 'feature', updated_at: '2026-01-02 10:00:00', parentId: 3, epicTitle }],
  }))
  answerTaskCalls(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  await touch($, 8)

  const ui = await mountBand($)
  expect((await ui.find({ type: 'Text', text: 'test-model' }))?.text).toBe(
    `test-model · 24.3k/400k 6% · #3 ${epicTitle.slice(0, 39)}… › #8 in_progress · 2 open`,
  )
  await ui.unmount()
})

test('another tool leaves the band alone', async ($, on) => {
  const lines: (string | undefined)[] = []
  const invalidations = harness(on, lines, () => ({
    open: 2,
    rows: [{ id: 7, type: 'feature', updated_at: '2026-01-01 10:00:00' }],
  }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  const before = invalidations.length
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  expect(invalidations.length).toBe(before)
})

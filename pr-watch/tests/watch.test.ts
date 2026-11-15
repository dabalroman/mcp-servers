import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

type Pr = { url: string; number: number; status: string }
type Task = { id: number; title: string; type: string; prs: Pr[]; parentId?: number; externalId?: string }
type Gh = { exitCode?: number; out?: unknown; err?: string }

const NOW = Date.parse('2026-01-01T12:00:00Z')
const url = (n: number) => `https://github.com/example-org/example-repo/pull/${n}`
const pr = (n: number, status: string): Pr => ({ url: url(n), number: n, status })
const answer = (value: unknown) => ({ value: { content: [{ type: 'text' as const, text: JSON.stringify(value) }], isError: false } })

const view = (state: string, extra: Record<string, unknown> = {}) => ({
  state,
  isDraft: false,
  headRefOid: 'aaaaaaaa11',
  mergeCommit: state === 'MERGED' ? { oid: 'abcdef1234' } : null,
  mergedAt: state === 'MERGED' ? '2026-01-01T11:55:00Z' : null,
  reviewDecision: null,
  ...extra,
})

const noFeedback = (n: number): Record<string, Gh> => ({
  [`issues/${n}/comments`]: { out: [[]] },
  [`pulls/${n}/reviews`]: { out: [[]] },
  [`pulls/${n}/comments`]: { out: [[]] },
})

// Stands for gh, git and the task-manager MCP beneath the plugin.
function world(on: On, tasks: Task[], branch = 'main') {
  const gh: Record<string, Gh> = {}
  const ghCalls: string[] = []
  const notes: { taskId: number; body: string }[] = []
  const prompts: string[] = []
  const failing = { notes: 0 }
  const byId = new Map(tasks.map(t => [t.id, t]))
  const epicOf = (t: Task) => (t.parentId === undefined ? {} : { epic: { id: t.parentId } })

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'this-session' }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  on('process.run', (_, e) => {
    const line = e.argv.join(' ')
    const done = (exitCode: number, stdout: string, stderr = '') => ({
      value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (line.startsWith('git ')) return done(0, `${branch}\n`)
    ghCalls.push(line)
    const key = Object.keys(gh).find(k => line.includes(k))
    const hit = key === undefined ? { exitCode: 1, err: 'HTTP 404: Not Found' } : gh[key]!
    return done(hit.exitCode ?? 0, hit.out === undefined ? '' : JSON.stringify(hit.out), hit.err ?? '')
  })
  on('mcp.call', (_, e) => {
    const a = e.args
    switch (e.tool) {
      case 'getByExternalId':
        return answer({ tasks: tasks.filter(t => t.externalId === a.externalId) })
      case 'getById': {
        const t = byId.get(Number(a.id))
        const children = tasks.filter(c => c.parentId === t?.id).map(c => ({ id: c.id }))
        return answer(t === undefined ? { error: 'not found' } : { task: { ...t, ...(t.type === 'epic' ? { children } : {}) } })
      }
      case 'getByPr':
        return answer({ tasks: tasks.filter(t => t.prs.some(p => p.url === a.url)).map(t => ({ ...t, ...epicOf(t) })) })
      case 'update':
        if (a.prs !== undefined) byId.get(Number(a.id))!.prs = a.prs as Pr[]
        return answer({ success: true })
      case 'addNote':
        if (failing.notes-- > 0) return answer({ error: 'database is locked' })
        notes.push({ taskId: Number(a.taskId), body: String(a.body) })
        return answer({ id: notes.length })
      default:
        return answer({ tasks: {} })
    }
  })

  return { gh, ghCalls, notes, prompts, byId, failing }
}

const BAND_PROPS = {
  hasSurvey: false,
  isCollapsed: false,
  isWorking: false,
  maxRows: 5,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 4 },
  view: {},
} as const

async function bandText($: Engine) {
  const ui = await $.ui.mount({ plugin: 'pr-watch', component: 'AbovePrompt', props: BAND_PROPS, surface: 'terminal' })
  const text = (await ui.find({ type: 'Text', text: /pr-watch/ }))?.text
  await ui.unmount()
  return text
}

async function start($: Engine, on: On, store: Record<string, unknown> = {}) {
  mock.store(on, store)
  const clock = mock.clock(on, { now: NOW })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  return { poll: () => clock.advance(60_000) }
}

test('the branch JIRA id finds the task; a merged PR is written merged, its other PR left alone', async ($, on) => {
  const w = world(on, [{ id: 1, title: 'Example', type: 'feature', externalId: 'ABC-12', prs: [pr(5, 'approved'), pr(6, 'open')] }], 'feature/ABC-12_example')
  Object.assign(w.gh, {
    'pr view 5': { out: view('MERGED') },
    'pr view 6': { out: view('OPEN') },
    'pr checks 6': { exitCode: 8, out: [{ name: 'build', bucket: 'pending', link: 'l1' }] },
    ...noFeedback(6),
  })
  const { poll } = await start($, on)
  await poll()

  expect(w.byId.get(1)!.prs).toEqual([pr(5, 'merged'), pr(6, 'open')])
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('PR #5 (#1 Example) merged as abcdef12')
  expect(w.prompts[0]).toContain('PR #5 (#1 Example) no deploy-dev workflow')
})

test('green checks and an approval write approved; a new push with pending checks goes back to open', async ($, on) => {
  const w = world(on, [{ id: 1, title: 'Example', type: 'feature', externalId: 'ABC-12', prs: [pr(5, 'open')] }], 'feature/ABC-12_x')
  Object.assign(w.gh, {
    'pr view 5': { out: view('OPEN', { reviewDecision: 'APPROVED' }) },
    'pr checks 5': { out: [{ name: 'build', bucket: 'pass', link: 'l1' }] },
    ...noFeedback(5),
  })
  const { poll } = await start($, on)
  await poll()
  expect(w.byId.get(1)!.prs).toEqual([pr(5, 'approved')])
  expect(await bandText($)).toBe('pr-watch · #5 approved')

  w.gh['pr view 5'] = { out: view('OPEN', { headRefOid: 'bbbbbbbb22', reviewDecision: 'APPROVED' }) }
  w.gh['pr checks 5'] = { exitCode: 8, out: [{ name: 'build', bucket: 'pending', link: 'l2' }] }
  await poll()
  expect(w.byId.get(1)!.prs).toEqual([pr(5, 'open')])
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('PR #5 (#1 Example) all checks passed on aaaaaaaa')
  expect(await bandText($)).toBe('pr-watch · #5 open')
})

test('a failed check starts one turn, and the next poll does not report it again', async ($, on) => {
  const w = world(on, [{ id: 1, title: 'Example', type: 'feature', externalId: 'ABC-12', prs: [pr(5, 'open')] }], 'feature/ABC-12_x')
  Object.assign(w.gh, {
    'pr view 5': { out: view('OPEN') },
    'pr checks 5': { exitCode: 1, out: [{ name: 'build', bucket: 'fail', link: 'https://example.test/run/1' }] },
    ...noFeedback(5),
  })
  const { poll } = await start($, on)
  await poll()
  await poll()

  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('PR #5 (#1 Example) check fail: build https://example.test/run/1')
})

test('an epic the agent opens brings its children; a list call adds nothing; a deploy writes deployed and one note', async ($, on) => {
  const w = world(on, [
    { id: 10, title: 'Epic', type: 'epic', prs: [] },
    { id: 11, title: 'Child', type: 'feature', parentId: 10, prs: [pr(7, 'merged')] },
  ])
  on('tool.call', (_, e) => ({ result: {}, text: JSON.stringify(e.tool.endsWith('getById') ? { task: { id: 10 } } : { tasks: {} }) }))
  Object.assign(w.gh, {
    'pr view 7': { out: view('MERGED') },
    'contents/.github/workflows/deploy-dev.yml': { out: {} },
    'run list': { out: [{ databaseId: 99 }] },
    'run view 99': { out: { status: 'completed', conclusion: 'success', jobs: [] } },
  })
  const { poll } = await start($, on)

  await $.tool.call({ tool: 'mcp__task-manager__getAll' })
  await poll()
  expect(w.ghCalls).toEqual([])

  await $.tool.call({ tool: 'mcp__task-manager__getById', id: 10 })
  await poll()
  await poll()

  expect(w.byId.get(11)!.prs).toEqual([pr(7, 'deployed')])
  expect(w.notes).toEqual([{ taskId: 10, body: 'PR #7 merged as abcdef12, deploy-dev 99: success' }])
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('PR #7 (#11 Child) merged as abcdef12, deploy-dev 99: success')
})

test('a failed deploy note is retried on the next poll, once', async ($, on) => {
  const w = world(on, [{ id: 1, title: 'Example', type: 'feature', externalId: 'ABC-12', prs: [pr(5, 'merged')] }], 'feature/ABC-12_x')
  w.failing.notes = 1
  Object.assign(w.gh, {
    'pr view 5': { out: view('MERGED') },
    'contents/.github/workflows/deploy-dev.yml': { out: {} },
    'run list': { out: [{ databaseId: 42 }] },
    'run view 42': { out: { status: 'completed', conclusion: 'failure', jobs: [{ name: 'deploy', status: 'completed', conclusion: 'failure' }] } },
  })
  const { poll } = await start($, on)
  await poll()
  expect(w.notes).toEqual([])

  await poll()
  await poll()
  expect(w.notes).toEqual([{ taskId: 1, body: 'PR #5 merged as abcdef12, deploy-dev 42: failure' }])
  expect(w.byId.get(1)!.prs).toEqual([pr(5, 'merged')])
  expect(w.prompts.length).toBe(1)
})

test('a task another live session owns is not polled here until this session writes to it', async ($, on) => {
  const w = world(on, [{ id: 1, title: 'Example', type: 'feature', externalId: 'ABC-12', prs: [pr(5, 'open')] }], 'feature/ABC-12_x')
  on('tool.call', () => ({ result: {}, text: JSON.stringify({ success: true }) }))
  Object.assign(w.gh, {
    'pr view 5': { out: view('OPEN') },
    'pr checks 5': { exitCode: 8, out: [{ name: 'build', bucket: 'pending', link: 'l1' }] },
    ...noFeedback(5),
  })
  const { poll } = await start($, on, { 'owner:1': { session: 'other-session', at: NOW + 60_000 } })
  await poll()
  expect(w.ghCalls).toEqual([])

  await $.tool.call({ tool: 'mcp__task-manager__update', id: 1, summary: 'x' })
  await poll()
  expect(w.ghCalls.some(c => c.startsWith('gh pr view 5'))).toBe(true)
})

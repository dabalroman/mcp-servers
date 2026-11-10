import type { Gh, PrRef } from './gh.ts'

export type PrStatus = 'draft' | 'open' | 'pipeline_pass' | 'approved' | 'merged' | 'deployed' | 'closed'

export type Ledger = {
  phase: 'pr' | 'deploy' | 'done'
  seen: string[]
  sha?: string
  mergedAt?: string
  run?: number
  failed?: boolean
  quiet?: boolean
  finishedAt?: number
}

export type PrEvent = { key: string; line: string; turn: boolean; toast?: boolean; note?: boolean }

export type PollResult = { status?: PrStatus; events: PrEvent[] }

export type PollConfig = { workflow: string }

const RUN_WAIT_MS = 20 * 60_000
const QUIET_AFTER_MS = 24 * 3600_000
const SNIPPET = 80
const SONAR_MARK = '<!-- sonarqube-quality-gate-comment -->'
const JOB_FAILED = new Set(['failure', 'cancelled', 'timed_out'])

type View = {
  state: string
  isDraft: boolean
  headRefOid: string
  mergeCommit: { oid: string } | null
  mergedAt: string | null
  reviewDecision: string | null
}
type Check = { name: string; bucket: string; link: string }
type User = { login: string }
type Comment = { id: number; user: User; body: string | null; created_at: string; path?: string }
type Review = { id: number; user: User; body: string | null; state: string; submitted_at: string }
type Run = { status: string; conclusion: string; jobs: { name: string; status: string; conclusion: string }[] }

export const newLedger = (): Ledger => ({ phase: 'pr', seen: [] })

const snippet = (text: string | null | undefined): string => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET)

  return t ? `: ${t}` : ''
}

const workflowName = (file: string): string => file.replace(/\.ya?ml$/, '')

async function list(gh: Gh, path: string): Promise<unknown[]> {
  const pages = (await gh.json(['api', '--paginate', '--slurp', path])) as unknown[][]

  return pages.flat()
}

async function feedback(gh: Gh, pr: PrRef, events: PrEvent[]): Promise<void> {
  const base = `repos/${pr.repo}`
  for (const c of (await list(gh, `${base}/issues/${pr.number}/comments`)) as Comment[]) {
    const body = c.body ?? ''
    if (body.startsWith(SONAR_MARK)) {
      if (/fail/i.test(body)) events.push({ key: `ic:${c.id}:fail`, line: 'SonarQube quality gate failed', turn: true })
      continue
    }
    events.push({ key: `ic:${c.id}`, line: `comment by ${c.user.login} at ${c.created_at}${snippet(c.body)}`, turn: true })
  }
  for (const r of (await list(gh, `${base}/pulls/${pr.number}/reviews`)) as Review[]) {
    if (r.state === 'COMMENTED' && !r.body) continue
    events.push({ key: `rv:${r.id}`, line: `review ${r.state} by ${r.user.login} at ${r.submitted_at}${snippet(r.body)}`, turn: true })
  }
  for (const c of (await list(gh, `${base}/pulls/${pr.number}/comments`)) as Comment[]) {
    events.push({ key: `rc:${c.id}`, line: `inline comment by ${c.user.login} on ${c.path ?? ''}${snippet(c.body)}`, turn: true })
  }
}

async function pollOpen(gh: Gh, pr: PrRef, ledger: Ledger, now: number, isNew: boolean): Promise<PollResult> {
  const n = String(pr.number)
  const v = (await gh.json([
    'pr', 'view', n, '--repo', pr.repo,
    '--json', 'state,isDraft,headRefOid,mergeCommit,mergedAt,reviewDecision',
  ])) as View
  const events: PrEvent[] = []

  if (v.state === 'MERGED' && v.mergeCommit?.oid && v.mergedAt) {
    // A PR merged long before it was first seen is settled without turns or notes.
    if (isNew && now - Date.parse(v.mergedAt) >= QUIET_AFTER_MS) ledger.quiet = true
    Object.assign(ledger, { phase: 'deploy', sha: v.mergeCommit.oid, mergedAt: v.mergedAt })
    events.push({ key: 'merged', line: `merged as ${v.mergeCommit.oid.slice(0, 8)}`, turn: false, toast: true })
    return { status: 'merged', events }
  }
  if (v.state === 'CLOSED') {
    Object.assign(ledger, { phase: 'done', finishedAt: now })
    events.push({ key: 'closed', line: 'closed without merge', turn: true, toast: true })
    return { status: 'closed', events }
  }

  const checks = (await gh.json(['pr', 'checks', n, '--repo', pr.repo, '--json', 'name,bucket,link'], {
    okExit: true,
    emptyOn: /no checks reported/,
  })) as Check[]
  for (const c of checks.filter(c => c.bucket === 'fail' || c.bucket === 'cancel')) {
    events.push({ key: `check:${c.link}:${c.bucket}`, line: `check ${c.bucket}: ${c.name} ${c.link}`, turn: true })
    ledger.failed = true
  }
  // No checks yet (right after a push) is not green.
  const green = checks.length > 0 && checks.every(c => c.bucket === 'pass' || c.bucket === 'skipping')
  if (green) {
    events.push({ key: `allpass:${v.headRefOid}`, line: `all checks passed on ${v.headRefOid.slice(0, 8)}`, turn: ledger.failed === true })
    ledger.failed = false
  }
  await feedback(gh, pr, events)

  return { status: openStatus(v, green), events }
}

function openStatus(v: View, green: boolean): PrStatus {
  if (v.isDraft) return 'draft'
  if (!green) return 'open'

  return v.reviewDecision === 'APPROVED' ? 'approved' : 'pipeline_pass'
}

async function pollDeploy(gh: Gh, pr: PrRef, ledger: Ledger, now: number, cfg: PollConfig): Promise<PollResult> {
  const events: PrEvent[] = []
  const name = workflowName(cfg.workflow)
  const sha = ledger.sha ?? ''
  if (ledger.run === undefined) {
    if (!(await gh.exists(`repos/${pr.repo}/contents/.github/workflows/${cfg.workflow}`))) {
      Object.assign(ledger, { phase: 'done', finishedAt: now })
      events.push({ key: 'noworkflow', line: `no ${name} workflow`, turn: false })
      return { events }
    }
    const runs = (await gh.json([
      'run', 'list', '--repo', pr.repo, '--workflow', cfg.workflow, '--commit', sha, '--json', 'databaseId',
    ])) as { databaseId: number }[]
    const first = runs[0]
    if (first === undefined) {
      if (now - Date.parse(ledger.mergedAt ?? '') >= RUN_WAIT_MS) {
        Object.assign(ledger, { phase: 'done', finishedAt: now })
        events.push({ key: 'norun', line: `no ${name} run after 20 min for ${sha.slice(0, 8)}`, turn: true })
      }
      return { events }
    }
    ledger.run = first.databaseId
  }

  const runUrl = `https://github.com/${pr.repo}/actions/runs/${ledger.run}`
  const r = (await gh.json(['run', 'view', String(ledger.run), '--repo', pr.repo, '--json', 'status,conclusion,jobs'])) as Run
  for (const j of r.jobs.filter(j => j.status === 'completed' && JOB_FAILED.has(j.conclusion))) {
    events.push({ key: `job:${ledger.run}:${j.name}`, line: `${name} job ${j.name}: ${j.conclusion} ${runUrl}`, turn: true })
  }
  if (r.status !== 'completed') return { events }

  Object.assign(ledger, { phase: 'done', finishedAt: now })
  events.push({
    key: `deploy:${ledger.run}`,
    line: `merged as ${sha.slice(0, 8)}, ${name} ${ledger.run}: ${r.conclusion}`,
    turn: true,
    toast: true,
    note: true,
  })

  return { status: r.conclusion === 'success' ? 'deployed' : undefined, events }
}

export async function pollPr(gh: Gh, pr: PrRef, ledger: Ledger, now: number, cfg: PollConfig, isNew = false): Promise<PollResult> {
  if (ledger.phase === 'done') return { events: [] }
  if (ledger.phase === 'deploy') return pollDeploy(gh, pr, ledger, now, cfg)
  const opened = await pollOpen(gh, pr, ledger, now, isNew)
  if (opened.status !== 'merged') return opened
  const deployed = await pollDeploy(gh, pr, ledger, now, cfg)

  return { status: deployed.status ?? opened.status, events: [...opened.events, ...deployed.events] }
}

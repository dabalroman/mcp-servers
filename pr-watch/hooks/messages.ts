import type { PrRef } from './gh.ts'
import type { Ledger, PrEvent, PrStatus } from './poll.ts'
import { workflowName } from './poll.ts'

export type TaskLabel = { id: number; title: string }

export const eventLine = (pr: PrRef, task: TaskLabel | undefined, event: PrEvent): string =>
  `PR #${pr.number}${task === undefined ? '' : ` (#${task.id} ${task.title})`} ${event.line} ${pr.url}`

export const shortLine = (pr: PrRef, event: PrEvent): string => `PR #${pr.number} ${event.line}`

export const BACKOFF_LABEL = 'gh failing, retry in 10 min'

// A finished PR (deployed, closed, deploy over) has no label: it drops off the line.
export function watchLabel(pr: PrRef, status: PrStatus | undefined, ledger: Ledger, workflow: string): string | undefined {
  if (ledger.phase === 'done') return undefined
  if (ledger.phase === 'deploy') {
    return `#${pr.number} merged, ${workflowName(workflow)} ${ledger.run === undefined ? 'waiting' : 'running'}`
  }
  const label = `#${pr.number} ${status ?? 'open'}`

  return ledger.failed === true ? `${label}, checks failing` : label
}

export function promptText(lines: string[]): string {
  return ['pr-watch:', ...lines.map(line => `- ${line}`)].join('\n')
}

export const errorText = (reason: string): string =>
  `pr-watch error: ${reason}. Polling slows to every 10 minutes until gh answers again; report this to the user.`

export function rulesSection(followUp: string): string {
  const success = followUp.trim() === '' ? '' : ` On success, propose: ${followUp.trim()}.`

  return [
    '# pr-watch',
    'The pr-watch plugin keeps the PR statuses and deploy notes on task-manager tasks: record a new PR in a task\'s `prs`, but never update PR statuses or write deploy notes yourself.',
    'A prompt starting with `pr-watch:` lists PR events. Report them, don\'t act on them:',
    '- failed or cancelled check: read the failed log (`gh run view <run> --log-failed`) and propose a fix;',
    '- all checks passed, merged, no deploy workflow: report it in one line; after a merge with no deploy to wait for, suggest the next step from the epic\'s order;',
    '- comment or review: name the author and the gist; for questions and change requests propose the reply or the fix;',
    `- deploy result: report the run and its conclusion; on failure the failed jobs and log lines with a proposed fix.${success} With an epic, then suggest the next step from its order;`,
    '- `pr-watch error`: report it verbatim.',
    'Start nothing (fix, commit, push, reply, audit) without the user\'s yes.',
  ].join('\n')
}

import type { PrStatus } from './poll.ts'
import type { Json } from './watchSet.ts'
import { taskId } from './watchSet.ts'

export type TaskCall = (tool: string, args: Json) => Promise<Json>

type Pr = { url: string; number: number; status: PrStatus }
type Carrier = { id: number; prs: Pr[]; epicId: number | undefined }

// Pre-merge statuses follow gh both ways; merged, deployed and closed only move forward.
const RANK: Record<PrStatus, number> = {
  draft: 0,
  open: 0,
  pipeline_pass: 0,
  approved: 0,
  merged: 1,
  deployed: 2,
  closed: 2,
}

async function carriers(call: TaskCall, url: string): Promise<Carrier[]> {
  const answer = await call('getByPr', { url })
  const tasks = Array.isArray(answer.tasks) ? (answer.tasks as Json[]) : []
  const found: Carrier[] = []
  for (const t of tasks) {
    const id = taskId(t.id)
    if (id === undefined || !Array.isArray(t.prs)) continue
    found.push({ id, prs: t.prs as Pr[], epicId: taskId((t.epic as Json | undefined)?.id) })
  }

  return found
}

export async function writeStatus(call: TaskCall, url: string, status: PrStatus): Promise<number[]> {
  const written: number[] = []
  for (const task of await carriers(call, url)) {
    const current = task.prs.find(p => p.url === url)
    if (current === undefined || current.status === status || RANK[status] < RANK[current.status]) continue
    await call('update', { id: task.id, prs: task.prs.map(p => (p.url === url ? { ...p, status } : p)) })
    written.push(task.id)
  }

  return written
}

export async function writeDeployNote(call: TaskCall, url: string, body: string): Promise<void> {
  const [first] = await carriers(call, url)
  if (first === undefined) return
  await call('addNote', { taskId: first.epicId ?? first.id, body })
}

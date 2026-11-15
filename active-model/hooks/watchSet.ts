// Copied from task-watch/hooks/watchSet.ts: the plugins install on their own, so none imports another.
export type Json = Record<string, unknown>

export const taskId = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN

  return Number.isInteger(n) && n > 0 ? n : undefined
}

export const parseJson = (text: unknown): Json | undefined => {
  if (typeof text !== 'string') return undefined
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null ? (value as Json) : undefined
  } catch {
    return undefined
  }
}

// List and search tools return many tasks the agent only looked at; they never join the watch set.
const SINGLE_TASK_TOOLS = new Set([
  'getById',
  'setStatus',
  'update',
  'replace',
  'addNote',
  'add',
  'getByPr',
  'getByExternalId',
])

export function touchedTaskIds(tool: string, input: Json, result: Json | undefined): number[] {
  if (!SINGLE_TASK_TOOLS.has(tool)) return []
  const ids = new Set<number>()
  const push = (value: unknown): void => {
    const id = taskId(value)
    if (id !== undefined) ids.add(id)
  }
  push(input.id)
  push(input.taskId)
  if (result !== undefined && result.error === undefined) {
    if (tool === 'add') push(result.id)
    const task = result.task as Json | undefined
    push(task?.id)
    if (Array.isArray(result.tasks)) {
      for (const entry of result.tasks as Json[]) {
        push(entry.id)
        push((entry.epic as Json | undefined)?.id)
      }
    }
  }

  return [...ids]
}

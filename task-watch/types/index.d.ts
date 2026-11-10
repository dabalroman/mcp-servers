export type Snapshot = {
  title: string
  status: string
  priority: string
  summary: string
  parentId: number | null
  refs: string[]
  prs: string
  updatedAt: string
  notes: Record<string, string>
  ownTouch: boolean
}

export type Group = { epicId: number | null; cursor: string; tasks: Record<string, Snapshot> }

export type Watch = { groups: Group[]; pending: string[] }

declare module 'claude-code' {
  interface PluginState {
    'task-watch': { watch: Watch }
  }
}

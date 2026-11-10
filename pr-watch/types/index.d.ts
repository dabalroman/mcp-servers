export type Watch = { taskIds: number[] }

declare module 'claude-code' {
  interface PluginState {
    'pr-watch': { watch: Watch; band: string[] }
  }
}

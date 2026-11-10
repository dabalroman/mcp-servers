import type { EngineInterface } from 'claude-code'

export class GhError extends Error {}

export type GhOptions = { okExit?: boolean; emptyOn?: RegExp }
export type Gh = {
  json: (args: string[], options?: GhOptions) => Promise<unknown>
  exists: (path: string) => Promise<boolean>
}

const label = (args: readonly string[]): string => `gh ${args.slice(0, 2).join(' ')}`
const lastLine = (text: string): string => text.trim().split('\n').pop() ?? ''

export function ghOf($: EngineInterface): Gh {
  const run = async (args: string[]) => {
    try {
      return await $.process.run(['gh', ...args], { timeoutMs: 60_000 })
    } catch (error) {
      throw new GhError(`${label(args)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    async json(args, { okExit = false, emptyOn } = {}) {
      const r = await run(args)
      if (emptyOn?.test(r.stderr)) return []
      // gh pr checks exits non-zero while checks are pending or failing; its JSON is still valid.
      if (r.exitCode !== 0 && !(okExit && r.stdout.trim() !== '')) {
        throw new GhError(`${label(args)} failing: ${lastLine(r.stderr)}`)
      }
      try {
        return JSON.parse(r.stdout)
      } catch {
        throw new GhError(`${label(args)}: unreadable output`)
      }
    },
    async exists(path) {
      const r = await run(['api', path, '--silent'])
      if (r.exitCode === 0) return true
      if (/Not Found|HTTP 404/.test(r.stderr)) return false
      throw new GhError(`gh api failing: ${lastLine(r.stderr)}`)
    },
  }
}

export type PrRef = { repo: string; number: number; url: string }

export function prRefOf(url: string): PrRef | undefined {
  const m = /github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/.exec(url)

  return m?.[1] === undefined || m[2] === undefined ? undefined : { repo: m[1], number: Number(m[2]), url }
}

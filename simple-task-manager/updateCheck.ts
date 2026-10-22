import { VERSION } from './version.js';

const REMOTE_VERSION_URL = 'https://raw.githubusercontent.com/dabalroman/mcp-servers/main/simple-task-manager/version.ts';
const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const VERSION_RE = /VERSION = '(\d{4}-\d{2}-\d{3})'/;

export type UpdateState = 'available' | 'current' | 'unknown';
export type UpdateCheckResult = { state: UpdateState; local: string; remote: string | null };
export type UpdateCheckDeps = { fetchImpl?: typeof fetch; now?: () => number };

let cached: UpdateCheckResult | null = null;
let cachedAt = 0;
let inFlight: Promise<UpdateCheckResult> | null = null;

export function resetUpdateCheckCache(): void {
  cached = null;
  cachedAt = 0;
  inFlight = null;
}

function parseRemoteVersion(source: string): string | null {
  return source.match(VERSION_RE)?.[1] ?? null;
}

async function fetchRemoteVersion(fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(REMOTE_VERSION_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return parseRemoteVersion(await res.text());
  } catch {
    return null;
  }
}

export function checkForUpdate(deps: UpdateCheckDeps = {}): Promise<UpdateCheckResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const nowMs = now();

  if (cached && nowMs - cachedAt < CACHE_TTL_MS) return Promise.resolve(cached);
  if (inFlight) return inFlight;

  inFlight = fetchRemoteVersion(fetchImpl).then((remote) => {
    const result: UpdateCheckResult = remote === null
      ? { state: 'unknown', local: VERSION, remote: null }
      : { state: VERSION < remote ? 'available' : 'current', local: VERSION, remote };
    cached = result;
    cachedAt = now();
    inFlight = null;
    return result;
  });

  return inFlight;
}

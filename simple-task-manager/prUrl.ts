export type PrRef = { host: string; repo: string; number: number };
export type PrLookup = { host?: string; repo: string; number: number };

// GitHub: /<owner>/<repo>/pull/N, GitLab: /<group>[/<subgroup>…]/<repo>/-/merge_requests/N.
// Anything after the number (/files, query, #fragment) is ignored; host and repo are lowercased.
export function parsePrUrl(url: string): PrRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const segs = parsed.pathname.split('/').filter(Boolean);
  for (let i = 0; i < segs.length; i++) {
    const isGithub = segs[i] === 'pull';
    const isGitlab = segs[i] === '-' && segs[i + 1] === 'merge_requests';
    if (!isGithub && !isGitlab) continue;
    const raw = segs[i + (isGithub ? 1 : 2)];
    if (raw === undefined || !/^\d+$/.test(raw)) continue;
    const number = Number(raw);
    if (number <= 0 || i === 0) return null;
    return { host: parsed.hostname.toLowerCase(), repo: segs.slice(0, i).join('/').toLowerCase(), number };
  }
  return null;
}

// Validates a getByPr input (a url, or repo + number) into what to search for.
export function resolvePrLookup(input: { url?: string; repo?: string; number?: number }): PrLookup {
  if (input.url !== undefined) {
    const ref = parsePrUrl(input.url);
    if (!ref) throw new Error(`Validation failed: "${input.url}" is not a recognised PR/MR url (expected .../pull/N or .../-/merge_requests/N).`);
    return ref;
  }
  if (input.repo === undefined || input.number === undefined) {
    throw new Error('Validation failed: pass a PR url, or both repo and number.');
  }
  const repo = input.repo.trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  if (repo.split('/').filter(Boolean).length < 2 || repo.includes('//')) {
    throw new Error(`Validation failed: repo must be owner/name (got "${input.repo}").`);
  }
  if (!Number.isInteger(input.number) || input.number <= 0) {
    throw new Error(`Validation failed: PR number must be a positive integer (got ${input.number}).`);
  }
  return { repo, number: input.number };
}

import { realpathSync, statSync } from 'node:fs';
import nodePath from 'node:path';
import { homedir, tmpdir } from 'node:os';

type PathImpl = Pick<typeof nodePath, 'relative' | 'isAbsolute' | 'sep'>;

export function defaultPlanRoots(): string[] {
  const roots = [nodePath.join(homedir(), '.claude', 'plans'), tmpdir()];
  const db = process.env['TASKS_DB'];
  if (db) roots.unshift(nodePath.dirname(nodePath.resolve(db)));
  return roots;
}

// path.relative is case-insensitive under win32 and yields an absolute path across drives
export function isWithin(root: string, target: string, impl: PathImpl = nodePath): boolean {
  const rel = impl.relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${impl.sep}`) && !impl.isAbsolute(rel);
}

function canonical(p: string): string | null {
  try {
    // .native expands Windows 8.3 short names (e.g. RUNNER~1 in tmpdir) so roots and targets compare equal
    return realpathSync.native(p);
  } catch {
    return null;
  }
}

export type PlanPathResult = { ok: true; path: string } | { ok: false; error: string };

export function checkPlanPath(path: string, roots: string[]): PlanPathResult {
  if (!nodePath.isAbsolute(path)) return { ok: false, error: `path must be absolute: ${path}` };
  if (!/\.md$/i.test(path)) return { ok: false, error: `path must be a .md file: ${path}` };
  const real = canonical(path);
  if (!real) return { ok: false, error: `cannot read ${path}: file not found` };
  const realRoots = roots.map(canonical).filter((r): r is string => r !== null);
  if (!realRoots.some((r) => isWithin(r, real))) {
    return { ok: false, error: `path is outside the allowed plan directories (${roots.join(', ')}): ${path}` };
  }
  if (!/\.md$/i.test(real)) return { ok: false, error: `path must resolve to a .md file: ${path}` };
  if (!statSync(real).isFile()) return { ok: false, error: `path is not a regular file: ${path}` };
  return { ok: true, path: real };
}

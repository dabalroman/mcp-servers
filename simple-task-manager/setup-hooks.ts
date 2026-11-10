#!/usr/bin/env node
import { execSync } from 'child_process';
import { writeFileSync, chmodSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let topLevel: string;
let commonDir: string;
try {
  const git = (args: string) => execSync(`git ${args}`, { cwd: __dirname, encoding: 'utf8' }).trim();
  topLevel = git('rev-parse --show-toplevel');
  commonDir = resolve(__dirname, git('rev-parse --git-common-dir'));
} catch {
  process.exit(0); // not a git repo, skip
}
// The hook assumes the mcp-servers layout; skip when this package sits in some other repo.
if (join(topLevel, 'simple-task-manager') !== __dirname) process.exit(0);

// Git runs the hook from the root of the committing tree, so relative paths act on that worktree.
// Stage only from that root: in a worktree commit git exports GIT_DIR, so a `git add` from a subdir
// treats the subdir as the tree root and stages files at the wrong paths.
const hook = `#!/bin/sh
set -e
(cd simple-task-manager && npx tsx bump-version.ts && npm test && npm run build)
git add simple-task-manager/version.ts simple-task-manager/plugin/.claude-plugin/plugin.json
for m in */.claude-plugin/plugin.json; do
  [ -f "$m" ] || continue
  p=\${m%%/*}
  (cd simple-task-manager && npx tsx bump-plugin.ts "../$p")
  git add "$m"
  claude plugin test "$p"
done
(cd simple-task-manager/task-manager-ui && npm test && npm run build)
git add simple-task-manager/task-manager-ui/dist
`;

const hooksDir = join(commonDir, 'hooks');
mkdirSync(hooksDir, { recursive: true });
const hookFile = join(hooksDir, 'pre-commit');
writeFileSync(hookFile, hook);
chmodSync(hookFile, 0o755);
console.log('pre-commit hook installed');

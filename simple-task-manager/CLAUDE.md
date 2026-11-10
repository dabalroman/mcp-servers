# Public repo

`~/.claude/mcp-servers/` is a **public** GitHub repository. Anything committed is world-readable and permanent (rewriting history later does not unpublish leaked content). Before writing or editing any file here:

1. **Do not commit user-specific paths.** Use `~/` or `<user-home>` in examples — never `/home/<username>/...` or any absolute home path.
2. **Do not commit real project names, task content, DB paths, or host names.** Use placeholders: `/abs/path/tasks.db`, `<project-name>`, `<host>`.
3. **Test fixtures and migration examples use synthetic data only** — invented titles, IDs starting from 1, fake scopes like `example-scope`.
4. **Scrub before every commit.** Run `git diff --staged` and reject anything matching the above.
5. **When in doubt, redact.** A placeholder is always safer than a real value.

---

# simple-task-manager — Development

**These are dev docs and they are deliberately not imported globally** — they load only when working
in this repo. Content reaches an agent through three channels, and mixing them is a real cost:

| Channel | Loads | Holds |
|---|---|---|
| `instructions.ts` | on MCP connect | core usage rules only (lifecycle, refinement-by-default, notes) — hard cap 4,096 chars |
| `plugin/RULES.md` | SessionStart hook of the `task-manager` plugin, only in repos whose `.mcp.json` has a `task-manager` entry | extended rules: epics, user prefixes, refs, projects, knowledge capture, repo binding — cap 10,000 chars |
| `CLAUDE.md` (this file) + `docs/claude/*.md` | on demand, when working in this repo; the topic files only when their row in **Context on demand** applies | everything about developing the package |

Claude Code cuts MCP server instructions at 4,096 chars and SessionStart hook output at 10,000 (beyond it only a 2,000-char preview shows). Both caps are asserted in `server.test.ts`. A rule lives in exactly one of the two files, and never in either when a tool description or param describe already states it (#473); anything new goes to `RULES.md` unless every session without the plugin must have it.

After any change to `server.ts`, `instructions.ts`, anything in `mcp/`, `tasks.ts`, `install.ts`, `plugin/` (skills, RULES.md, hook), or these dev docs — review `simple-task-manager/README.md` and update it to reflect the change. The README is the user-facing source of truth; keep it in sync, but keep it compact (#374): no per-tool reference tables or restated rules, because the tool descriptions and plugin/RULES.md already reach Claude. Add a line, not a section.

## Context on demand

Not loaded by default. **Read the file before working on its topic.**

| Topic | Read | When |
|---|---|---|
| SQLite store, migrations, epics, external IDs, `Store` consumers | `docs/claude/storage-and-migrations.md` | Touching `tasks.ts`, `migrations/`, a schema change, a new `Store` method, or epic/notes/refs storage |
| Projects (#360/#369/#370) | `docs/claude/projects.md` | Anything about project binding, project-aware handlers, `PROJECT_NAME`, or the UI's project tabs/URLs |
| MCP tools and handlers | `docs/claude/mcp-tools.md` | Adding or changing a tool, handler, list output, summary gate, or `updateCheck` |
| Bundled vs client mode, UI spawn, `--server on/off`, pm2 | `docs/claude/run-modes-and-server-setup.md` | `server.ts` startup/shutdown, `mcp/uiChild.ts`, `serverSetup.ts`, `/api/config`, `TASK_UI_MODE`, pm2 app names |
| Streamable HTTP MCP and API keys | `docs/claude/mcp-over-http.md` | `mcp/http.ts`, `/mcp`, API keys, the Connect a machine dialog |
| `.mcp.json` env vars and `health` config checks | `docs/claude/mcp-config-env.md` | Adding/renaming an env var, `mcpConfig.ts`, `install.ts` output, `health`'s Config/Plugin sections |
| The `tm` plugin (skills, RULES.md, hook, versioning) | `docs/claude/plugin.md` | Anything under `plugin/`, `bump-version.ts`, the plugin version check in `health` |

## Toolchain

- TypeScript 5.6+, strict + `noUncheckedIndexedAccess` + `noImplicitOverride` + `noFallthroughCasesInSwitch`. Source `.ts` files live at the package root; production runs from `dist/` (built by `tsc`). `tsconfig.json` excludes tests from emit; `tsconfig.test.json` extends it and includes them for typecheck only.
- Tests run via `node --import tsx --test <files>` — `tsx` strips types on the fly, no precompile. The `test` script lists each test file by name: a new `*.test.ts` must be added there or it never runs.
- `npm run verify` = typecheck + test + build. The pre-commit hook (`~/.claude/mcp-servers/.git/hooks/pre-commit`) runs from the committing tree's root with relative paths (so a worktree commit acts on that worktree): it bumps `version.ts` + plugin.json and every root `*/.claude-plugin` plugin's patch version on every commit, runs all tests (`npm test`, `claude plugin test <plugin>`, the UI's), and rebuilds `dist/`. Hook text is static; rerun `npx tsx setup-hooks.ts` only when it changes.
- `dist/` is `.gitignore`d. Production entry: `node dist/server.js`. The `.mcp.json` template generated by `install.ts` points at `dist/server.js`.
- Tests must import sibling modules with the `.js` extension (NodeNext module resolution) — e.g. `from './tasks.js'` in a `.ts` file resolves to `tasks.ts` at compile time and `dist/tasks.js` at runtime.
- `server.test.ts` imports the real handlers directly — there is no copied handler logic in tests. Query handlers are async: test call sites must `await` them inside an `async` test.
- `install.ts` is a top-level script (calls `process.exit`) and cannot be imported; its testable logic lives in `mcpConfig.ts` (tested in `install.test.ts`).

## tsconfig — excluding the UI sub-package

`tsconfig.json` and `tsconfig.test.json` both list `task-manager-ui` in `exclude`. Without that, the MCP's `tsc` walks into the sub-package and tries to compile its `@/*`-aliased / DOM-typed sources with the MCP's NodeNext config, which fails. The sub-package has its own tsconfig (bundler resolution, JSX, DOM lib) and runs its own typecheck in its own `npm run verify`. Keep these worlds separate.

## task-watch (root plugin)

`task-watch/` only reads task-manager (`getById`, `getUpdates`). It suppresses the agent's own writes by applying each call to its snapshot field by field, never by a full `getById` refresh, and ignores `prs` (pr-watch owns them). The live watch sits in module memory mirrored to `$.state`, because every `$.state.get` in one dispatch returns the value from when the dispatch began.

## Git repo location

The git repository root is `~/.claude/mcp-servers/`, **not** `~/.claude/mcp-servers/simple-task-manager/`. The `simple-task-manager/` directory has no `.git` of its own — it is a subdirectory of the `mcp-servers` repo. Always run git commands from `~/.claude/mcp-servers/` (or pass `-C ~/.claude/mcp-servers`). The pre-commit hook lives at `~/.claude/mcp-servers/.git/hooks/pre-commit` and is installed by `simple-task-manager/setup-hooks.ts`.

Every commit that implements or closes a task-manager task **must use this subject format**: `#<id>/<type>/<scope>: <description>`, e.g. `#172/fix/task-manager: always sync skills`. This keeps git history traceable back to the task that motivated the change.

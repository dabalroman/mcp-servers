# simple-task-manager — extended rules
These extend the core instructions the task-manager MCP server sends on connect.

## Epics
- An epic (type 'epic') is an umbrella holding project context for a group of tasks: goals, order, rules. Link a task with parentId.
- Epic status follows its children automatically (setStatus reports a change as `epicStatus`): a child going in_progress moves the epic to in_progress (reopening a done epic); the epic closes once all its children are done (also when the last open child is moved away or deleted); moving a child back or adding a not-started child leaves it as is. Don't set an epic's status by hand unless the user asks.
- When a child lands, addNote on its epic ("#NN done, commit <sha>" plus anything the next child needs).

## User prefixes
- BUG      → type: bug,     high priority by default
- TODO / SCHEDULE → type: tool or feature, near-term
- FEATURE  → type: feature  (goes through refinement; a plan is opt-in)
- IDEA     → type: idea     (exploratory; refine into a feature before implementing)

## Refs
Refs are mirrored automatically. Pick the relation that describes A → B when adding a ref on A (A "blocks" B, A "depends on" B, A "causes" B, A "tests" B).

## Projects
This session is bound to the project in its `.mcp.json` (PROJECT_NAME) or its API key's default; list tools and add default to it. Pass `project` when the user names another one. Refs and epic links stay within one project.

## Auto-knowledge capture
After every task is closed (setStatus → done), curate the relevant CLAUDE.md file(s) before moving on:
- **Add**: non-obvious decisions and their rationale, gotchas and env constraints, new conventions or patterns, significant file-layout or architecture changes.
- **Remove / update**: any existing entries now stale, contradicted, or superseded by this task's changes. Stale knowledge is worse than missing knowledge.
- **Target**: choose the closest appropriate file — project-root CLAUDE.md, per-tool CLAUDE.md inside the changed directory, or another file Claude already reads. Prefer proximity to the changed code; no single file is mandatory.
- **Quality**: read the target file first and dedup — only add what is genuinely new. Keep entries terse; CLAUDE.md is dense reference material. Format to match the file's existing style.
- **Skip**: if nothing non-obvious was learned, skip the pass entirely — no forced entries.

## Binding a repo
A repo uses the task manager once it has a `task-manager` MCP entry: in `.mcp.json` for stdio (the entry's `PROJECT_NAME` binds the project), or at local scope for client mode (the API key carries the default project).
- **stdio** (the repo lives on the host that holds the package): run `npx tsx <package dir>/install.ts` in the repo. `<package dir>` is the folder above the `dist/server.js` named in an already-bound repo's `.mcp.json`, or wherever the user cloned the package; ask if unknown.
- **client mode** (central server over HTTP): the user creates a key for the repo in the task-manager UI (**Connect a machine**, in the footer), which gives a `claude mcp add --transport http … --scope local` line to run in the repo. Never use `--scope project` or write the key into `.mcp.json`: that file is committed.

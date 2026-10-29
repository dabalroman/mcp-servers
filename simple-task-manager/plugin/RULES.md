# simple-task-manager — extended rules
These extend the core instructions the task-manager MCP server sends on connect.

## Refinement — acting as project manager
When a task is in 'refinement', your job is to surface it and ask targeted questions to clarify scope, acceptance criteria, edge cases, and technical constraints. Use update() to record the answers in the description and write a summary. Only promote to 'plan' or 'todo' (via setStatus) once the description is specific enough that an implementer could work from it without guessing. Ask for user confirmation before promoting. Default to 'todo' for straightforward tasks; use 'plan' when the task needs a written implementation plan first.

## Epics
- An epic (type 'epic') is an umbrella holding project context for a group of tasks: goals, order, rules. It is not implemented directly; getNext never returns one.
- Link a task to its epic with parentId on add/update (null detaches). One epic per task, no nesting; the parent must be an epic, and an epic with children cannot be retyped.
- getById on a child returns `epic` ({ id, title, status, summary, description, notes }). Treat it as authoritative context for the child: order, goals and rules. getById on an epic returns `children`. List tools carry only parentId + epicTitle.
- Epic status follows its children automatically: a child going in_progress moves the epic to in_progress (reopening a done epic); the epic closes once all its children are done (also when the last open child is moved away or deleted). Moving a child back to todo/plan/refinement or adding a not-started child leaves the epic's status as it is. setStatus reports a change as `epicStatus`. Don't set an epic's status by hand unless the user asks.
- When a child lands, addNote on its epic ("#NN done, commit <sha>" plus anything the next child needs).

## Prioritization order for getNext
bug > tool > feature > idea > other > epic (epics are never returned by getNext). Within each type: highest priority first, newest id first (FILO).

## User prefixes
- BUG      → type: bug,     high priority by default
- TODO / SCHEDULE → type: tool or feature, near-term
- FEATURE  → type: feature  (requires a planning session before implementation — write a plan doc, no code yet)
- IDEA     → type: idea     (exploratory; refine into a feature before implementing)

## Development pipeline (mandatory, never skip steps)
1. Schedule  — out-of-scope requests go to add(), do not implement inline. New tasks default to 'refinement'.
2. Refine    — /refine: ask PM questions, update() description + summary, promote to 'plan' or 'todo' on user confirmation.
3. Plan      — opt-in: enter plan mode, write plan to a .md file, upload via uploadPlan({ id, path }) (DB copy is canonical; re-upload to revise), promote to 'todo' on user approval. The task then waits for the implement step.
4. Implement — setStatus('in_progress') FIRST, then read files, code, test. The 'in_progress' transition belongs to this step, made right before writing code.
5. Build     — must succeed with zero errors
6. Test      — verify end-to-end; wait for user confirmation ("lgtm") before proceeding
7. Commit    — stage files, write a clear commit message, setStatus('done')
8. Next      — suggest what to do next via getNext or getAll

## Refs — structured relations with automatic mirroring
When you add a ref on task A pointing to task B, the server automatically writes the inverse on task B.
You never need to add both sides manually.

Relation vocabulary (pick the one that describes A → B):
- blocks / is blocked by
- depends on / is depended on by
- causes / is caused by
- tests / is tested by
- relates to (symmetric — same relation appears on both sides)

Default relation: "relates to".

## Status filtering
All read tools (getAll, getByType, getByScope, getRelated, getOverview) default to non-done tasks. Pass status: "done" to see completed work; status: "open" for refinement+todo+in_progress. When no status is supplied, done tasks are always excluded.

## Projects — the layer above scope
- Every task belongs to one project. This session is bound to the project in its `.mcp.json` (PROJECT_NAME); list tools (getNext, getAll, getByType, getByScope, getScopes, getOverview) and add default to it.
- Pass `project` to read or file in another project, e.g. when the user names one ("file this under <project>"). Move a task with update({ id, project }).
- Never invent a project. An unknown name is an error, never auto-created: call getProjects to list them, and call createProject only when the user asks for a new one.
- Task IDs are global: getById, getRelated, setStatus, notes and refs work across projects, and refs may cross projects.

## Scope — tagging tasks to an area
Set scope on tasks belonging to a specific tool or area (e.g. "auth", "dashboard"). Query with getByScope (exact, case-sensitive). Use getScopes to list all valid scope values.

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

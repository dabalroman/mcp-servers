# simple-task-manager — extended rules
These extend the core instructions the task-manager MCP server sends on connect.

## Epics
- An epic (type 'epic') is an umbrella holding project context for a group of tasks: goals, order, rules. Link a task with parentId.
- Epic status follows its children automatically (setStatus reports a change as `epicStatus`): a child going in_progress moves the epic to in_progress (reopening a done epic); the epic closes once all its children are done (also when the last open child is moved away or deleted); moving a child back or adding a not-started child leaves it as is. Don't set an epic's status by hand unless the user asks.
- An epic's order lives in its children's seq (10, 20, 30; equal = parallel), set with reorder. Its description keeps only the gates and why, never an id list.
- Adding a child the user placed ('next', 'after #NN'): pass position and tell the user its placement.
- When a child lands, addNote on its epic ("#NN done, commit <sha>" plus anything the next child needs).
- Keep the flow: after any work on an epic or one of its children (refine, plan, implement, land, or a question about it), end by suggesting the next step from the children's seq and the epic's gates: which child, which pipeline step, and what it waits on (a merge, a deploy, the user's go). Read the order with getEpic if it is not in context. Suggest only; start it only on the user's yes.

## User prefixes
- BUG      → type: bug,     high priority by default
- TODO / SCHEDULE → type: tool or feature, near-term
- FEATURE  → type: feature  (goes through refinement; a plan is opt-in)
- IDEA     → type: idea     (exploratory; refine into a feature before implementing)

## Refs
Refs are mirrored automatically. Pick the relation that describes A → B when adding a ref on A (A "blocks" B, A "depends on" B, A "causes" B, A "tests" B).

## Projects
This session is bound to the project in its `.mcp.json` (PROJECT_NAME) or its API key's default; list tools and add default to it. Pass `project` when the user names another one. Refs and epic links stay within one project.
- Next-step suggestions (after a task lands, a session ends, or an epic step) come only from the bound project. Never offer to refine, plan or implement another project's task. If the landed task's text names one there that waited on it, add one line at most ("FYI: #NN in <project> is now unblocked"), with no offer or question.

## Repos
A project spanning sibling repos registers them (getRepos). Projects without repos skip this.
- The registry is the single source for each repo's folder, commands and rules file, and for contract rules: read getRepos or getById's `repoContext`, never sibling CLAUDE.md files, for them. A registry command that fails: read that repo's rulesFile, then fix the entry with setRepo.
- Set `repo` (and `touches`) per task; an epic child never inherits them.
- A contract change starts in its owner repo. Pass `contract` on that task and offer its `suggestedFollowUps` to the user; file only what they pick.

## Auto-knowledge capture
After every task is closed (setStatus → done), curate the relevant CLAUDE.md file(s) before moving on:
- **Add**: non-obvious decisions and their rationale, gotchas and env constraints, new conventions or patterns, significant file-layout or architecture changes.
- **Remove / update**: any existing entries now stale, contradicted, or superseded by this task's changes. Stale knowledge is worse than missing knowledge.
- **Target**: choose the closest appropriate file — project-root CLAUDE.md, per-tool CLAUDE.md inside the changed directory, or another file Claude already reads. Prefer proximity to the changed code; no single file is mandatory.
- **Quality**: read the target file first and dedup — only add what is genuinely new. Keep entries terse; CLAUDE.md is dense reference material. Format to match the file's existing style.
- **Skip**: if nothing non-obvious was learned, skip the pass entirely — no forced entries.

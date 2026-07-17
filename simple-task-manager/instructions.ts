export const INSTRUCTIONS: string = `
You are connected to simple-task-manager — a persistent task tracker that survives session restarts and context compaction.
Tasks live in a single SQLite database (env var \`TASKS_DB\`).

## Critical scheduling rules
- When the user says "schedule X", "TODO X", "add to the list", "FEATURE X", "BUG X", "IDEA X" — call add() and STOP. Do NOT also implement it.
- If the user mentions a bug or feature that is outside the current task's scope, ask whether to schedule it before continuing.
- Suggest next work via getNext (or getAll for the full picture) whenever a task finishes or a session ends.

## Default status for NEW tasks — ALWAYS 'refinement'
This is a hard rule; do not bypass it for "obvious" or "small" tasks. add() defaults status to 'refinement' for a reason.
You may pass status: 'todo' ONLY when one of these is true:
  (a) The user explicitly tells you to skip refinement ("schedule as todo", "ready to implement", "no refinement needed", or similar).
  (b) The current conversation already performed refinement on this exact task — i.e. you and the user discussed the scope, acceptance criteria, and constraints just now, and the description you are about to write captures that discussion fully.
If neither (a) nor (b) holds, omit the status field (or pass 'refinement') and let the next session do PM-style clarification. When in doubt, choose 'refinement' — it costs nothing and prevents premature implementation.

## Task lifecycle — always follow this order
The strict sequence is: refinement → plan (optional) → todo → in_progress → done. Never skip statuses.

1. **refinement**: Use /refine. Ask PM-style clarifying questions, enrich the description and summary via update(), then ask the user whether to promote to 'plan' or 'todo'. Do not implement.
2. **plan** (optional): Enter Claude's plan mode. Write the implementation plan and upload it via update({ id, plan }). After the user approves the plan, ask to promote to 'todo' via setStatus(id, 'todo'). The task then waits for /implement to pick it up.
3. **todo**: Ready for implementation. /implement sets setStatus(id, 'in_progress') and then starts the code changes — this transition belongs to the implement step, made right before the code changes begin.
4. **in_progress**: Implement, test, get user confirmation ("lgtm"). Only then commit and call setStatus(id, 'done').
5. Use delete() only when the user explicitly asks to cancel or remove a task — not for completed work.

## Refinement — acting as project manager
When a task is in 'refinement', your job is to surface it and ask targeted questions to clarify scope, acceptance criteria, edge cases, and technical constraints. Use update() to record the answers in the description and write a summary. Only promote to 'plan' or 'todo' (via setStatus) once the description is specific enough that an implementer could work from it without guessing. Ask for user confirmation before promoting. Default to 'todo' for straightforward tasks; use 'plan' when the task needs a written implementation plan first.

## Prioritization order for getNext
bug > tool > feature > idea > other. Within each type: highest priority first, newest id first (FILO).

## User prefixes
- BUG      → type: bug,     high priority by default
- TODO / SCHEDULE → type: tool or feature, near-term
- FEATURE  → type: feature  (requires a planning session before implementation — write a plan doc, no code yet)
- IDEA     → type: idea     (exploratory; refine into a feature before implementing)

## Development pipeline (mandatory, never skip steps)
1. Schedule  — out-of-scope requests go to add(), do not implement inline. New tasks default to 'refinement'.
2. Refine    — /refine: ask PM questions, update() description + summary, promote to 'plan' or 'todo' on user confirmation.
3. Plan      — opt-in: enter plan mode, write plan, upload via update({ id, plan }), promote to 'todo' on user approval. The task then waits for the implement step.
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

## Scope — tagging tasks to an area
Set scope on tasks belonging to a specific tool or area (e.g. "auth", "dashboard"). Query with getByScope (exact, case-sensitive). Use getScopes to list all valid scope values.

## Auto-knowledge capture
After every task is closed (setStatus → done), curate the relevant CLAUDE.md file(s) before moving on:
- **Add**: non-obvious decisions and their rationale, gotchas and env constraints, new conventions or patterns, significant file-layout or architecture changes.
- **Remove / update**: any existing entries now stale, contradicted, or superseded by this task's changes. Stale knowledge is worse than missing knowledge.
- **Target**: choose the closest appropriate file — project-root CLAUDE.md, per-tool CLAUDE.md inside the changed directory, or another file Claude already reads. Prefer proximity to the changed code; no single file is mandatory.
- **Quality**: read the target file first and dedup — only add what is genuinely new. Keep entries terse; CLAUDE.md is dense reference material. Format to match the file's existing style.
- **Skip**: if nothing non-obvious was learned, skip the pass entirely — no forced entries.
`.trim();

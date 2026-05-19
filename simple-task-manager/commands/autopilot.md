---
description: Autonomous batch implementation of todo tasks in a scope. Each task on its own branch (task/<id>-<slug>), full pipeline including tests, no per-task confirmation. User reviews branches at the end and merges. Args: optional scope; menu if omitted.
---

# Autopilot

Unsupervised batch implementation across a scope. Pick scope → implement every `todo` task on its own branch → report. The user reviews branches locally afterwards and merges good ones to `main`. **Local-only — never push to a remote.**

## Pre-granted permissions (assumed)

By invoking `/autopilot` the user has authorised, for this run:

- Local git: `branch`, `checkout`, `commit`. **Never push to any remote** — the autopilot environment has no SSH keys, the push will fail, and the user reviews branches locally anyway. **Never** force-push. **Never** delete branches.
- `npm` scripts: `verify`, `lint`, `typecheck`, `test`, `build`, `install` — run without asking.
- Restart any project-defined pm2 processes when server-touching tasks land (look up names from `pm2 ls` or the project CLAUDE.md).
- Spawning subagents with `run_in_background: true` without per-spawn confirmation.

If something falls outside this list (force-push, dependency upgrade, schema change to a shared DB, anything destructive), **hard stop** and add a note to the final report instead of asking mid-run — the user is away.

## Usage

`/autopilot [scope]`

- **No argument** — call `mcp__task-manager__getScopes`, present the list (with open-task counts) via `AskUserQuestion`, let the user pick one. Then proceed.
- **With argument** — fuzzy-match against `getScopes` the same way `/implement` does. Single match → use it. Multiple → ask. None → report and stop.

After scope is resolved, fetch all `todo` tasks in that scope via `mcp__task-manager__getByScope(scope)` filtered to `status === 'todo'`, ordered by priority then id. This is the **queue**. Show the user the queue once (ids + titles) and the planned branch names — **stop and ask "proceed? (yes / no)"** before starting. This is the only mid-run confirmation.

## Hard-stop conditions (skip task, continue queue)

If any of these hit, mark the task as **skipped** in the final report and move on — do **not** stop the whole run:

- Task is actually `refinement`, not `todo` (state changed since queue was built) → leave status untouched, note "needs /refine".
- Acceptance criteria unclear or scope obviously larger than the description → leave status untouched, note "scope creep / unclear, needs refinement".
- Permission required that wasn't pre-granted (see list above) → note which permission and why.
- Verify (`npm run verify`) fails after one round of fixes by the worker agent → leave branch unmerged for user inspection, note the failure.

## Branching strategy

- One branch per task: **`task/<id>-<slug>`** where `<slug>` is the task title lowercased, alphanumerics + hyphens, trimmed to ~40 chars.
- Branch off **`main`** (fresh `git checkout main && git pull` once at the start of the run; then `git checkout -b task/<id>-<slug>` per task).
- **Stacking for small related tasks**: if two or more tasks in the queue are *both* trivially small (<20 line diff each) *and* clearly related (same file or feature), the worker may stack them on one branch named `task/<lowest-id>-<slug>-batch`. Default is one-per-branch; only stack when the diff is genuinely small and grouping is obvious. Report stacked tasks together.
- **Never** touch `main` directly. **Never** delete or rename existing branches.

## Workflow

### Step 0 — Setup (once)

1. `git status --short` — if working tree is dirty, hard-stop the whole run (don't risk mixing user's WIP into a task branch). Report and exit.
2. `git checkout main && git pull --ff-only` — if pull fails, hard-stop and report.
3. Resolve scope (menu or fuzzy match).
4. Build the queue and show it to the user. Ask "proceed?". On yes, continue. On no, exit.

### Step 1 — Per task

For each task in the queue, in order:

1. **Re-check status** via `mcp__task-manager__getById(id)`. If no longer `todo`, skip (note in report).
2. **Classify complexity** (drives both planning and worker choice):
   - **Low** (≤3 files, concrete fix described, <50 line diff, no architectural decisions) → no plan required, implement inline in the main context.
   - **Medium** (4–8 files, OR introduces a new pattern, OR spans one subsystem with multiple decisions) → **plan required**, then implement via subagent.
   - **High** (cross-subsystem, new architecture, >8 files, schema/API changes, or estimated diff >300 lines) → **plan required**, then implement via subagent.
3. **Plan (medium/high only) — autonomous, no user prompt**:
   - If the task already has a non-empty `plan` field, **skip** this step and use it as-is.
   - Otherwise dispatch a planning subagent (`run_in_background: true` if you can do other work in parallel; foreground otherwise). Recommended type: `Plan` agent if available, else `architect-reviewer` for cross-cutting, else the same specialist you'd use for implementation. The prompt must contain: task id, full title + description (from `getById`), project CLAUDE.md style rules, scope context, and the instruction: "produce an implementation plan in markdown. Cover: files to touch (paths), key decisions with one-line rationale, edge cases, test strategy, rollout/verification steps. Do NOT write code. Return the plan body only."
   - When the planner returns, write the plan to the task: `mcp__task-manager__update({ id, plan: <plan body> })`. Then proceed to implementation — the planner does not get a confirmation gate. (User reviews the plan post-hoc on the branch.)
4. **Pick the worker agent** based on the task's scope and contents — consult the project `CLAUDE.md` agent table for the exact names available in this workspace. Typical mapping:
   - UI/component work → a React specialist (e.g. `react-specialist`)
   - Express/server/Node work → a Node specialist (e.g. `node-specialist`)
   - Type-heavy / generics / cross-layer types → a TypeScript specialist (e.g. `typescript-pro`)
   - Spans server + UI together → a fullstack developer (e.g. `fullstack-developer`)
   - When in doubt → a fullstack developer.
5. **Create the branch**: `git checkout main && git checkout -b task/<id>-<slug>`.
6. **Set status**: `mcp__task-manager__setStatus(id, 'in_progress')`.
7. **Implement**:
   - Low → do it inline. Read files, edit, add/update tests.
   - Medium/High → spawn the chosen agent with `run_in_background: true`. The prompt must include: task id, full title + description (call `getById` to get the latest), **the `plan` field (now guaranteed to be present)**, the project CLAUDE.md style rules summary, branch name, and these instructions: "follow the plan; read relevant files, implement, add/update tests, run `npm run verify` until green (one retry max if it fails), report back with: list of files changed, test result, any deviations from the plan and why, any open questions." When you have other independent tasks to start, dispatch their agents in parallel; otherwise wait for this one before continuing.
8. **Verify**: ensure `npm run verify` is green. If red after one fix attempt, leave the branch with the failing state committed-or-not (your call — don't commit broken code, but don't lose the work either; stash it as a WIP commit on the branch with message `WIP: <task title> — verify failing`), note in report, move on.
9. **Restart pm2** if the task touched server entry points or process config (e.g. `server.ts`, `src/server/**`, `ecosystem.config.cjs`). Use `pm2 ls` to find the project's process names and `pm2 restart <name>` (run `npm run build` first if the process serves built output).
10. **Commit**: stage changed files (named explicitly, not `-A`), commit with a clear message describing the *why*. **No `Co-Authored-By` line.** Conventional-commits style preferred (`feat:`, `fix:`, `chore:`, etc.). One commit per task unless the task itself demands multiple logical commits.
11. **Do NOT push.** The branch stays local — the user reviews and merges locally. No `git push`, ever.
12. **Leave status as `in_progress`** — do **not** set `done`. The user sets `done` after they verify and merge. Add a note in the task via `update({ id, description: <description + "\\n\\n**Autopilot:** local branch `task/<id>-<slug>` ready, awaiting review."> })` so future sessions know where the work landed.
13. Move to next task. Return to `main` first: `git checkout main`.

### Step 2 — Final report

After the queue is drained (or all remaining items are skipped), produce **one** markdown summary in the chat. Format:

```
## Autopilot run — scope: <scope> — <date>

### Implemented (N)
- task/<id>-<slug> — #NN <title> — <commit sha> — verify ✓ — pm2: <restarted? y/n>
- ...

### Skipped (M)
- #NN <title> — reason: <refinement / scope creep / verify failed / permission>

### Notes
- Anything the user should know before merging (e.g. "task #87 depends on #86, merge #86 first").
```

Do **not** chat during the run. The final summary is the only user-facing message after the initial "proceed?" confirmation.

## Agent dispatch reminder

Per [[feedback_async_agent_dispatch]]: set `run_in_background: true` on worker agents unless the *next* main-context step depends on the agent's result. In an autopilot run, after dispatching a worker we usually wait for it to finish before committing — so foreground is fine for the immediately-next task, but if you batch-dispatch multiple parallel small tasks, mark them all background.

## Task-manager status discipline (mandatory)

Keep the task-manager DB in sync at every transition — it is the source of truth the user inspects between sessions.

- **Start of run**: queue is built from `getByScope` filtered to `status === 'todo'`. Don't mutate anything yet.
- **Just before implementing a task**: `setStatus(id, 'in_progress')`. Always, even for simple inline tasks.
- **Skipped tasks**: leave status untouched (still `todo` or `refinement`). Append a note via `update({ id, description })` explaining why it was skipped (`refinement needed`, `scope creep`, `verify failing on branch task/<id>-<slug>`, etc.) so the next session sees it.
- **After push (successful task)**: status stays `in_progress` — do **not** set `done`. The user moves it to `done` after merge. Update the description (or, if the task has a `plan` field, append to it) with: branch name, commit SHA, verify result, anything notable. One line is fine: `**Autopilot 2026-MM-DD:** branch `task/<id>-<slug>` @ <sha>, verify ✓, awaiting review.`
- **Verify-failing tasks**: status stays `in_progress`, branch still exists with WIP commit, description gets `**Autopilot 2026-MM-DD:** branch `task/<id>-<slug>` — verify failing: <one-line reason>. Needs follow-up.`
- **Never** call `setStatus(id, 'done')` from autopilot. The user owns that transition.
- **Never** call `delete(id)` from autopilot.

The final markdown summary mirrors the DB state — if a task isn't reflected correctly in the DB, the summary is wrong.

## Why this pattern

The user is away. Confirmations are batched: one "proceed?" at the start, one summary at the end. Branches are the safety net — every task is isolated, nothing reaches `main` without a human review. Status stays `in_progress` so the user's manual merge + `setStatus('done')` remains the source of truth for completion.

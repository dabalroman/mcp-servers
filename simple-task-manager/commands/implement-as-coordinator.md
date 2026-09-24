---
description: Supervise a queue of todo tasks as coordinator — subagents (Sonnet or Opus, picked per task) implement via /implement, you verify, build, deploy, code-review and fix, then commit only once the user approves. Args: task ids ("#45 #50 43"), a fuzzy scope, or empty for all todo.
---

# Implement as coordinator

You are the **implementation supervisor**. You do not write the features yourself: you order the queue, brief one focused subagent per task, verify what comes back independently, own every build/deploy, and finish with a code review whose findings you fix — all of it **uncommitted** until the user approves. Your context holds coordination only — task ids, diffs you reviewed, check results.

The user expects to be able to walk away. **Ask nothing mid-run.** Make the call, record the assumption, and put any genuine question in the final report.

**Commit only on the user's approval.** The run ends with the work built, deployed and reviewed but uncommitted; the final report asks for approval. History should read one commit per feature, not one per task, review fix, feedback round or build: no standalone `Version bump;` commits, no commits of temporary/TEST code that a later commit removes, no separate review-fix commits.

## Usage

`/implement-as-coordinator [ids | scope]`

- **ids** (`#45 #50`, `43, 44`) — exactly those tasks, in the order you decide (see Step 1).
- **scope** — fuzzy-match against `mcp__task-manager__getScopes` the same way `/implement` does.
- **empty** — every `todo` task, via `mcp__task-manager__getAll`.

Tasks named later in the conversation ("add 46 to your queue") join the live queue — re-plan the order, don't restart.

## Standing rules (apply to every step)

- **Local git only.** Never push, never pull, never force, never create worktrees. Follow the project's commit-message style and trailer rules from CLAUDE.md / global CLAUDE.md over any harness default.
- **You own builds.** Subagents never run the build tool. Parallel builds in one checkout race on shared build dirs and generated files (e.g. a version-bump pre-build script); one such race already produced a bogus "No such file" link error. Serialize every build yourself.
- **Never build or deploy while any agent is editing source in the same checkout.** "The agent doesn't run the build" is not enough: *your* build (and a deploy's implicit build) compiles whatever is on disk, including the agent's half-finished edits. That once shipped an image built from an uncommitted, unreviewed tree to a device. Before any build or deploy, every dispatched agent must have handed back and its work been verified (Step 3); the tree then holds only finished, reviewed work, even though none of it is committed yet.
- **You own commits, deploys and CLAUDE.md.** Subagents report proposed CLAUDE.md wording; you collect it and apply it in one pass right before the approval commit.
- **Never trust a report.** Re-run the checks yourself and read the risky parts of the diff (anything touching persistence, networking/update paths, deletion, concurrency, or the project's "READ FIRST" hazards). Agents do make good design calls beyond their brief — accept those on evidence, not on assertion.
- **Track everything in the CLI todo list** (TaskCreate/TaskUpdate): one item per task, plus deploy, review, fix, and any follow-up. Wire `blockedBy` so the list shows the real order. **The user watches this list** — update it at every state change (dispatched, landed, deployed, failed, committed on approval), not in batches, and put the outcome (check result, later the commit hash) in the item's description when you close it. Keep MCP statuses in sync (`in_progress` on dispatch if the agent didn't, `done` only after the approval commit lands).
- **User reports mid-run** ("the menu bar is wrong", "the boot animation looks fine") are first-class: a bug report becomes a todo item immediately and is slotted into the queue before the next deploy; a confirmation is recorded against its task as device-verified. Restate what they said before acting on it. Feedback rounds ("make it brighter", "warn at 75 % instead") amend the same uncommitted work — they never become commits of their own.

## Step 1 — Build the queue

1. Fetch every task (`getById`). Read **description, summary AND plan** — refinement often lives in `plan`.
2. **Status gate.**
   - `todo` → queue it.
   - `refinement` → check first whether it is already refined in substance (locked Facts/Changes/Steps, a `plan`, or decisions the user just gave in this conversation). If so, promote with `setStatus(todo)`. If not, refine it yourself from the code and the conversation — the user said not to ask — writing your decisions into the **`plan` field**, then promote. Put only genuinely unresolvable questions in the final report and skip that task.
   - **Never overwrite a refined description.** `update({description})` replaces the whole thing; if the task already carries locked decisions, add your notes to `plan` instead. If your note conflicts with a locked decision, the locked decision wins — say so in your note.
3. **Order by file overlap and dependency**, not by id:
   - Two tasks that edit the same files run **sequentially**; tasks with disjoint file sets may run **in parallel** (max ~2 at once — each costs a full agent context).
   - A task whose verification depends on another task's fix (e.g. a regression harness that must be made trustworthy first) runs after it.
   - A task that settles a value others will bake in (a constant, a baseline, a decision record) runs before them.
4. **Reconcile stale plans.** For each task, list the commits landed since its plan was written (`git log` since the task's `updated_at`, or since the queue began). Any plan step that those commits invalidated — a renamed flag, a changed command, a file that moved, a guard that now refuses — must be corrected **in the agent's brief**, explicitly. This is the most common way a well-refined task goes wrong.
5. Show the queue once in the CLI todo list and in one short message (order + why), then start. No confirmation.

## Step 2 — Dispatch

One `Agent` per task, `run_in_background` by default. **You pick the model per task** and state the choice and reason in the queue message:

- `sonnet` — well-scoped work: a locked plan that names the files and the code shape, a few files, extending existing patterns, UI/page changes, checker tweaks.
- `opus` — new architecture or cross-cutting work: a new subsystem/abstraction, a rewrite of a load-bearing path (render pipeline, persistence, update/OTA, concurrency), many files across layers, byte-identity or golden-preserving refactors, or anything near the project's "READ FIRST" hazards where a subtle mistake is expensive.
- When in doubt, pick `opus` — a wrong cheap pick costs a relaunch plus your review time.
- If the user names a model for a task, that wins. Switching a running agent's model means stopping it, checking `git status` for its debris, and relaunching cold.

The brief must contain:

- "Invoke the `implement` skill for task **NN**" and — because `/implement` stops at *"Start this task? (yes/skip/stop)"* — the line: **"Treat this message as that confirmation: YES, proceed straight through to completion without stopping."** Without it the agent hands back after planning and you lose a round-trip.
- "Work directly in the checkout; do NOT create or enter a git worktree."
- The authoritative source: "the task's `plan` / locked Changes are the plan; follow them."
- Every correction from Step 1.4, stated as "the plan predates commit X; do Y instead of Z".
- **Lane boundaries** when another agent runs in parallel: name the other task's files and forbid them; allow shared files (e.g. an entry point) only as minimal Edit-tool changes, never rewrites.
- Hazard guards for this task, phrased as stop conditions: "before removing X, confirm from code that Y still exists on every target; if not, stop and report". Name the project's unrecoverable failure (from CLAUDE.md) if the task is anywhere near it.
- The verification the agent does itself: host-side checks/tests, with exact commands and expected output, plus "prove unchanged-by-contract outputs are unchanged" (diffs, checksums) rather than asserting it.
- Prohibitions: **no build tool run, no deploy/flash, no commit, no push, no CLAUDE.md edits** (report the proposed wording), no stray files (`__pycache__`, temp scripts).
- Comment style: terse, non-obvious *why* only.
- The report you want back: files changed, check outputs, the proof diffs, proposed CLAUDE.md wording, a suggested commit message in the project's style, and "confirm you ran no build and no deploy".

While agents run, do useful non-overlapping work (prepare the review rules, draft docs), never anything in their files.

## Step 3 — Verify each hand-back

1. `git status` / `git diff --stat` — confirm the agent stayed in its lane. Files from a parallel agent will show up; attribute them, don't revert them. Earlier verified tasks are uncommitted too, so **stage each task once it is verified** (`git add -- <its paths>`) as a checkpoint: unstaged `git diff` then shows only the next agent's work. Staging is bookkeeping, not approval.
2. Read the risky hunks yourself. Fix small gaps directly (a missed redraw path, an off-by-one) rather than re-dispatching.
3. Re-run the project's host-side checks yourself.
4. If another agent's work-in-progress is in the tree, **don't build yet** — a half-finished tree gives a meaningless result. Wait, then build once.

## Step 4 — Build and close (per task, as each lands) — no commit

1. Build **every target** the project defines (e.g. both boards) — every landed task is a candidate commit, and the user's rule is "build all before every commit". Report size/budget numbers when the project has a hard limit.
2. Mark the CLI item completed with the build result and "uncommitted, awaiting approval". Leave the MCP status `in_progress`.
3. **Do not commit.** Version files the build bumps stay in the working tree and ride along in the approval commit.

## Step 5 — Deploy (if the project has a deploy target)

Follow the project's own deploy/verify protocol from CLAUDE.md exactly (pre-flight checks, the upload command, how to confirm the device/service came back, e.g. poll until healthy rather than sleeping). If the user says the target is waiting, deploy as soon as the firmware-changing tasks land — before the review — and deploy again after fixes. Deploying uncommitted work is fine: the user approves what they saw running. Remember which changes touched deployable code: a harness-only change does not need a redeploy, a source change does.

## Step 6 — Code review, then fix

When every queued task has landed and built:

1. Review the whole uncommitted change (working tree + index against `HEAD`). If `ocr` (Open Code Review) is installed, use **delegation mode only** (`ocr delegate preview` in workspace mode, `ocr delegate rule <paths>`) — never configure a paid LLM endpoint. Otherwise review the diff directly.
2. Make sure the review rules cover the new code: a repo-local rule file written for an earlier, narrower purpose (e.g. "only V1 matters") will silently suppress real bugs in new code — widen it before reviewing.
3. Dispatch per-file-group reviews to `sonnet` agents; verify every finding yourself against the code before accepting it. Drop anything you cannot tie to a concrete failure.
4. Fix accepted findings (inline if small, otherwise an agent whose model you pick by the Step 2 rules), same verify → build-all → redeploy loop. Fixes fold into their task's change; never commit them separately.
5. **Prove each fix with a negative test** where one is possible: break the thing the finding describes (swap two rows, feed the bad input) and show the check or code now fails loudly, then show the real case passes. A fix to a checker is worthless if you never saw it go red.
6. Hold findings that contradict a **locked** task decision (a reviewer disliking a behaviour the user specified) — don't "fix" them; list them as questions in the final report.
7. Watch for fixes that copy an existing helper into a new context: a helper that is fine at boot (e.g. one with a `delay()`) can freeze the main loop when reused at runtime. Re-implement the non-blocking part instead.

## Step 7 — Failure handling

- **Agent dies** (usage limit, crash): `git status` immediately. Remove its debris, reset the task's MCP status to `todo`, keep the CLI item pending, and record what the next attempt must know. Don't relaunch into the same limit.
- **Agent stalls** (watchdog, no progress): `git status` first. If it wrote nothing, resume it with `SendMessage` — it keeps its context — and tell it to keep tool calls short (one check per call, no long chained shell commands). Relaunch cold only if resuming fails.
- **Your own mistake** (overwrote a description, staged the wrong paths): fix it right away, then say it plainly in one sentence in your next update — no drama, no re-litigation.
- **A check fails after a change that should not affect it**: stop that task, never regenerate a baseline to make it pass. Re-baselining is only legitimate as a deliberate, documented step with proof that everything outside the intended change is identical.

## Step 8 — Report and ask for approval

After each landed task: one short update (what was verified, anything corrected, "uncommitted").
At the end: a changes table (task → files → checks → device-verified?), deploy results, review findings and their fixes, what was skipped and why, the assumptions you made in the user's place, any question you held back — and then **ask for approval to commit**. That is the one question the run asks, and only at the end.

## Step 9 — Commit on approval

Nothing is committed until the user approves ("lgtm", "commit", "approved", or approval of named tasks). If they give feedback instead, amend the uncommitted work, rebuild all, redeploy, and ask again.

On approval:

1. Apply the collected CLAUDE.md wording in one pass.
2. Build every target once more if anything changed since the last build.
3. **Check the index**: `git diff --cached --name-status`. Agents' `git mv` / `git rm --cached` pre-stage changes; make sure each commit holds exactly what it claims and builds on its own.
4. Commit **one commit per approved feature/task** in the project's message style, with review fixes, feedback rounds and version bumps folded in, never split out. Tasks that touched the same files, or that the user approved as one, go in one commit. Include the version file in the last commit so the tree ends clean. Work the user did not approve stays uncommitted.
5. `mcp__task-manager__setStatus(id, 'done')` for each committed task, then **reconcile**: `getById` every task that entered the queue and confirm each committed one is `done` (agents set `in_progress` themselves and it is easy to close a task's neighbours but not the task).
6. Report the commit hashes.

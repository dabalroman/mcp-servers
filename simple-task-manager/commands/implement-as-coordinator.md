---
description: Supervise a queue of todo tasks as coordinator — Sonnet subagents implement via /implement, you verify, build, commit per task, deploy, then code-review and fix. Args: task ids ("#45 #50 43"), a fuzzy scope, or empty for all todo.
---

# Implement as coordinator

You are the **implementation supervisor**. You do not write the features yourself: you order the queue, brief one focused subagent per task, verify what comes back independently, own every build/commit/deploy, and finish with a code review whose findings you fix. Your context holds coordination only — task ids, diffs you reviewed, check results, commit hashes.

The user expects to be able to walk away. **Ask nothing mid-run.** Make the call, record the assumption, and put any genuine question in the final report.

## Usage

`/implement-as-coordinator [ids | scope]`

- **ids** (`#45 #50`, `43, 44`) — exactly those tasks, in the order you decide (see Step 1).
- **scope** — fuzzy-match against `mcp__task-manager__getScopes` the same way `/implement` does.
- **empty** — every `todo` task, via `mcp__task-manager__getAll`.

Tasks named later in the conversation ("add 46 to your queue") join the live queue — re-plan the order, don't restart.

## Standing rules (apply to every step)

- **Local git only.** Never push, never pull, never force, never create worktrees. Follow the project's commit-message style and trailer rules from CLAUDE.md / global CLAUDE.md over any harness default.
- **You own builds.** Subagents never run the build tool. Parallel builds in one checkout race on shared build dirs and generated files (e.g. a version-bump pre-build script); one such race already produced a bogus "No such file" link error. Serialize every build yourself.
- **Never build or deploy while any agent is editing source in the same checkout.** "The agent doesn't run the build" is not enough: *your* build (and a deploy's implicit build) compiles whatever is on disk, including the agent's half-finished edits. That once shipped an image built from an uncommitted, unreviewed tree to a device. Before any build or deploy, `git status` must show only committed work — or only the finished task you are about to commit.
- **You own commits, deploys and CLAUDE.md.** Subagents report proposed CLAUDE.md wording; you apply it in one pass right before that task's commit.
- **Never trust a report.** Re-run the checks yourself and read the risky parts of the diff (anything touching persistence, networking/update paths, deletion, concurrency, or the project's "READ FIRST" hazards). Agents do make good design calls beyond their brief — accept those on evidence, not on assertion.
- **Track everything in the CLI todo list** (TaskCreate/TaskUpdate): one item per task, plus deploy, review, fix, and any follow-up. Wire `blockedBy` so the list shows the real order. **The user watches this list** — update it at every state change (dispatched, landed, committed, deployed, failed), not in batches, and put the outcome (commit hash, check result) in the item's description when you close it. Keep MCP statuses in sync (`in_progress` on dispatch if the agent didn't, `done` only after the commit lands).
- **User reports mid-run** ("the menu bar is wrong", "the boot animation looks fine") are first-class: a bug report becomes a todo item immediately and is slotted into the queue before the next deploy; a confirmation is recorded against its task as device-verified. Restate what they said before acting on it.

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

One `Agent` per task, `model: "sonnet"`, `run_in_background` by default. The brief must contain:

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

1. `git status` / `git diff --stat` — confirm the agent stayed in its lane. Files from a parallel agent will show up; attribute them, don't revert them.
2. Read the risky hunks yourself. Fix small gaps directly (a missed redraw path, an off-by-one) rather than re-dispatching.
3. Re-run the project's host-side checks yourself.
4. If another agent's work-in-progress is in the tree, **don't build yet** — a half-finished tree gives a meaningless result. Wait, build once, then commit each task separately by path.

## Step 4 — Build, commit, close (per task, as each lands)

1. Build **every target** the project defines (e.g. both boards) — the user's rule is "build all before every commit". Report size/budget numbers when the project has a hard limit.
2. Apply that task's CLAUDE.md wording (the one batched pass).
3. **Check the index before committing**: `git diff --cached --name-status`. An agent's `git mv` or `git rm --cached` leaves changes **pre-staged**, and a plain `git commit` sweeps them into the wrong task — producing a commit that does not build on its own. Commit by path (`git commit -m ... -- <paths>`) or unstage the foreign entries first. If it happened anyway and the commit is local and seconds old: `git reset --soft HEAD~1`, unstage, recommit.
4. Commit with the project's message style. Include generated artifacts the build bumps (version files) in the last commit of a batch so the tree ends clean.
5. `mcp__task-manager__setStatus(id, 'done')`; mark the CLI item completed.

## Step 5 — Deploy (if the project has a deploy target)

Follow the project's own deploy/verify protocol from CLAUDE.md exactly (pre-flight checks, the upload command, how to confirm the device/service came back, e.g. poll until healthy rather than sleeping). If the user says the target is waiting, deploy as soon as the firmware-changing commits land — before the review — and deploy again after fixes. Remember which commits changed deployable code: a harness-only commit does not need a redeploy, a source commit does.

## Step 6 — Code review, then fix

When every queued task is committed:

1. Review the whole range (`<commit before the run>..HEAD`). If `ocr` (Open Code Review) is installed, use **delegation mode only** (`ocr delegate preview --from A --to B`, `ocr delegate rule <paths>`) — never configure a paid LLM endpoint. Otherwise review the diff directly.
2. Make sure the review rules cover the new code: a repo-local rule file written for an earlier, narrower purpose (e.g. "only V1 matters") will silently suppress real bugs in new code — widen it before reviewing.
3. Dispatch per-file-group reviews to `sonnet` agents; verify every finding yourself against the code before accepting it. Drop anything you cannot tie to a concrete failure.
4. Fix accepted findings (inline if small, a Sonnet agent if not), same verify → build-all → commit → redeploy loop.
5. **Prove each fix with a negative test** where one is possible: break the thing the finding describes (swap two rows, feed the bad input) and show the check or code now fails loudly, then show the real case passes. A fix to a checker is worthless if you never saw it go red.
6. Hold findings that contradict a **locked** task decision (a reviewer disliking a behaviour the user specified) — don't "fix" them; list them as questions in the final report.
7. Watch for fixes that copy an existing helper into a new context: a helper that is fine at boot (e.g. one with a `delay()`) can freeze the main loop when reused at runtime. Re-implement the non-blocking part instead.

## Step 7 — Failure handling

- **Agent dies** (usage limit, crash): `git status` immediately. Remove its debris, reset the task's MCP status to `todo`, keep the CLI item pending, and record what the next attempt must know. Don't relaunch into the same limit.
- **Agent stalls** (watchdog, no progress): `git status` first. If it wrote nothing, resume it with `SendMessage` — it keeps its context — and tell it to keep tool calls short (one check per call, no long chained shell commands). Relaunch cold only if resuming fails.
- **Your own mistake** (overwrote a description, committed the wrong index): fix it right away, then say it plainly in one sentence in your next update — no drama, no re-litigation.
- **A check fails after a change that should not affect it**: stop that task, never regenerate a baseline to make it pass. Re-baselining is only legitimate as a deliberate, documented step with proof that everything outside the intended change is identical.

## Step 8 — Report

After each landed task: one short update (commit hash, what was verified, anything corrected).
At the end: the commits table, deploy results, review findings and their fixes, what was skipped and why, the assumptions you made in the user's place, and — only now — any question you held back.

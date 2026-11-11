---
name: implement-as-coordinator
description: Supervise a queue of todo tasks as coordinator — subagents (Sonnet or Opus, picked per task) implement via /tm:implement, you verify, build, deploy, code-review and fix, then commit only once the user approves (or per child in Epic mode). Args: task ids ("#45 #50 43"), an epic id, a fuzzy scope, or empty for all todo.
---

# Implement as coordinator

You are the **implementation supervisor**. You don't write features: you order the queue, brief one subagent per task, verify each hand-back independently, own every build/deploy, and fix the findings of a final code review. Your context holds coordination only: task ids, reviewed diffs, check results.

The user expects to walk away. **Ask nothing mid-run** except the Epic mode commit-mode question and breakpoints once no other work is left. Decide, record the assumption, put genuine questions in the final report.

**Commit only on the user's approval** (or per child in Epic commit mode). The run ends built, deployed, reviewed and uncommitted. One commit per task (per phase if the user chose phase commits): no standalone `Version bump;`, review-fix, feedback or build commits, no commits of temporary/TEST code a later commit removes.

## Usage

`/tm:implement-as-coordinator [ids | scope]`

- **ids** (`#45 #50`, `43, 44`) — exactly those tasks, in the order you decide (Step 1).
- **scope** — match case-insensitively against `mcp__task-manager__getScopes`: the tag containing every word of the argument (lowercased, punctuation stripped). Several → list and ask; none → report and stop.
- **empty** — every `todo` task: `mcp__task-manager__getAll({ status: 'todo' })`.
- **an epic id** (`#44`) — Epic mode: the epic's children are the queue. `/tm:implement` hands epics to this skill.

Tasks named later ("add 46 to your queue") join the live queue: re-plan, don't restart.

## Epic mode

- **Epic is authoritative.** Read it via `getById` first: description, notes and `children`. The children's `seq` (unset last, then id) replaces Step 1.3's overlap ordering; children sharing a `seq` are a parallel group (overlap can still veto running them together). Its Order of execution gates and Rules beat this skill's defaults (branching, what waits on what), and its gates are breakpoints too.
- **Epic status** follows its children (`setStatus` syncs it); skipped children keep it open.
- **Unready children.** A child in `refinement` or `plan` is skipped, not refined (overrides Step 1.2), and so is a ready child ordered after a skipped one. The final report lists them with "run `/tm:refine #NN`" (or "plan #NN").
- **Commit mode.** Before the first dispatch ask once: "Commit each child as it lands?". On yes, commit each child (each phase, if its plan has phases — dispatch one agent per phase: "implement only phase K of task NN") once it passes Step 3, Step 4's build-all and Step 6 on its own diff. Fixes and feedback on a committed child become a new commit titled with its id, never mashed into another child's. A child parked at a breakpoint is committed only after the user's lgtm. Then `setStatus(child, 'done')` and Step 9.6's epic note. On no, the normal approval flow applies; Step 9 then has only the uncommitted children.

## Standing rules (every step)

- **Local git only.** No push, pull, force or worktrees. Project and global CLAUDE.md commit-message/trailer rules beat any harness default.
- **You own builds, deploys, commits and CLAUDE.md.** Subagents never run the build tool: parallel builds in one checkout race on shared build dirs and generated files (e.g. a version-bump pre-build script) — one race produced a bogus "No such file" link error. Serialize every build. Subagents propose CLAUDE.md wording; you apply it in its task's commit (Step 9.1, or each child's commit in Epic commit mode).
- **Never build or deploy while any agent is editing source in the same checkout.** Your build (or a deploy's implicit one) compiles whatever is on disk, half-finished edits included — that once shipped an unreviewed tree to a device. Every agent hands back and is verified (Step 3) first.
- **Never trust a report.** Re-run the checks; read the diff's risky parts (persistence, networking/update paths, deletion, concurrency, the project's "READ FIRST" hazards). Accept an agent's good calls beyond its brief on evidence, not assertion.
- **Track everything in the CLI todo list** (TaskCreate/TaskUpdate): an item per task, deploy, review, fix and follow-up, `blockedBy` giving the real order. **The user watches it**: update on every state change (dispatched, landed, deployed, failed, committed), not in batches; closing, put the outcome (check result, later commit hash) in the description. Keep MCP statuses in sync (`in_progress` on dispatch if the agent didn't; `done` only after the task's commit).
- **Breakpoints — defer, don't stop.** A breakpoint needs the user: a change only they can test (UI, device, their data) or a merge/deploy only they do. Mark them up front in the queue message and CLI list. Park a task at one (verified, built, staged, uncommitted) and continue everything independent of it; tasks sharing its files or ordered after it wait too, keeping each commit clean. When nothing else can proceed, present all pending breakpoints at once, per task exactly what to test or do; then commit what they approved (commit mode) and resume.
- **User reports mid-run** are first-class; restate what they said before acting. A bug report becomes a todo item at once, slotted before the next deploy; a confirmation marks its task device-verified. Feedback rounds ("make it brighter") amend the uncommitted work, never their own commit (Epic commit mode: see Commit mode).

## Step 1 — Build the queue

1. `getById` every task; read **description, summary, plan AND notes** (refinement often lives in `plan` or `notes`; notes are as authoritative as the description, newest statement wins).
2. **Status gate.**
   - `todo` → queue it. `plan` → skip (plan awaits the user's approval), list in the final report.
   - `refinement` → in Epic mode, skip. Otherwise, if refined in substance (locked Facts/Changes/Steps, a `plan`, or decisions the user just gave), `setStatus(todo)`; if not, refine it yourself from code and conversation (don't ask), write your decisions into the **`plan` field**, then promote. Genuinely unresolvable questions go in the final report and the task is skipped.
   - **Never overwrite a refined description** (`update({description})` replaces it whole): with locked decisions present, record yours via `addNote({ taskId, body })`. On conflict the locked decision wins — say so in the note.
3. **Order by file overlap and dependency**, not by id:
   - Same files → **sequential**; disjoint → may run **in parallel** (max ~2 — each costs a full agent context).
   - A task whose verification depends on another's fix (e.g. a regression harness to make trustworthy first) runs after it.
   - A task settling a value others bake in (a constant, a baseline, a decision record) runs first.
4. **Reconcile stale plans.** List commits landed since each plan was written (`git log` since the task's `updated_at`, or since the queue began). Correct every plan step they invalidated (renamed flag, changed command, moved file, a guard that now refuses) **explicitly in the agent's brief** — the most common way a well-refined task goes wrong.
5. Show the queue once (CLI list + one short message: order, why, breakpoints), then start.

## Step 2 — Dispatch

One `Agent` per task, `run_in_background` by default. **Pick the model per task**, reason in the queue message:

- `sonnet` — well-scoped: a locked plan naming files and code shape, few files, existing patterns, UI/page changes, checker tweaks.
- `opus` — new architecture or cross-cutting: a new subsystem/abstraction, a rewrite of a load-bearing path (render pipeline, persistence, update/OTA, concurrency), many files across layers, byte-identity or golden-preserving refactors, anything near the project's "READ FIRST" hazards.
- In doubt, `opus`: a wrong cheap pick costs a relaunch plus your review.
- A model the user names wins. Switching a running agent's model = stop it, `git status` for debris, relaunch cold.

The brief must contain:

- "Invoke the `tm:implement` skill for task **NN**, and carry on through to completion without stopping."
- "Work directly in the checkout; do NOT create or enter a git worktree."
- "The task's `plan` / locked Changes are the plan; follow them."
- Each Step 1.4 correction as "the plan predates commit X; do Y instead of Z".
- **Lane boundaries** when another agent runs in parallel: its files, forbidden; shared files (e.g. an entry point) only as minimal Edit-tool changes, never rewrites.
- Hazard guards as stop conditions ("before removing X, confirm from code that Y still exists on every target; if not, stop and report"), naming the project's unrecoverable failure (CLAUDE.md) if the task is anywhere near it.
- Its own verification: host-side checks/tests with exact commands and expected output, and "prove unchanged-by-contract outputs are unchanged" (diffs, checksums), not assert it.
- "No per-phase commits; the coordinator commits."
- **No build tool run, no deploy/flash, no commit, no push, no CLAUDE.md edits** (report proposed wording), no stray files (`__pycache__`, temp scripts).
- Comments: terse, non-obvious *why* only.
- "Run `/tm:implement`'s OCR code review step and fix its findings before handing back — it is not optional."
- Report back: files changed, check outputs, proof diffs, OCR summary (coverage, fixed, left open with reasons — or "Skipping code review, OCR not installed"), proposed CLAUDE.md wording, a suggested commit message in the project's style, "confirm you ran no build and no deploy".

Meanwhile do non-overlapping work (review rules, doc drafts), never in their files.

## Step 3 — Verify each hand-back

1. `git status` / `git diff --stat` — lane respected? A parallel agent's files show up too: attribute, don't revert. **Stage each task once verified** (`git add -- <its paths>`) so unstaged `git diff` shows only the next agent's work. Staging is bookkeeping, not approval.
2. Read the risky hunks; fix small gaps (a missed redraw path, an off-by-one) directly, don't re-dispatch.
3. Re-run the host-side checks yourself.
4. Another agent's work-in-progress in the tree → **don't build yet**; wait, then build once.

## Step 4 — Build (per task, as each lands) — no commit

1. Build **every target** (e.g. both boards): each landed task is a candidate commit, and the rule is "build all before every commit". Report size/budget against any hard limit.
2. Close the CLI item with the build result and "uncommitted, awaiting approval"; MCP status stays `in_progress`. Build-bumped version files ride along in the approval commit.

## Step 5 — Deploy (if the project has a target)

Follow the project's CLAUDE.md deploy/verify protocol exactly (pre-flight, upload, poll until the device/service is healthy — don't sleep). If the user says the target is waiting, deploy once the firmware-changing tasks land (before review) and after fixes. Uncommitted deploys are fine: the user approves what they saw running. A harness-only change needs no redeploy; a source change does.

## Step 6 — Code review, then fix

Once every queued task has landed and built (skip in Epic commit mode — done per child):

1. Review the combined uncommitted change (tree + index vs `HEAD`; agents ran OCR per task) with `ocr` in **delegation mode only** (`ocr delegate preview` in workspace mode, `ocr delegate rule <paths>`) — never configure a paid LLM endpoint. Assume it is installed; only on `command not found` (exit 127) tell the user **"Skipping code review, OCR not installed"**, review the diff directly, and repeat that line in the final report.
2. A repo-local rule file written for an earlier, narrower purpose (e.g. "only V1 matters") silently suppresses real bugs in new code — widen it first.
3. Dispatch per-file-group reviews to `sonnet` agents; verify each finding against the code, dropping any not tied to a concrete failure.
4. Fix accepted findings (inline if small, else an agent picked by Step 2's rules) through verify → build-all → redeploy; fixes fold into their task's change.
5. **Prove each fix with a negative test** where possible: break what the finding describes (swap two rows, feed the bad input), show it now fails loudly, then show the real case passes. A checker fix never seen red is worthless.
6. Findings contradicting a **locked** decision (a reviewer disliking behaviour the user specified) are held, not fixed: list them as questions in the final report.
7. A fix reusing a helper in a new context: one fine at boot (e.g. with a `delay()`) can freeze the main loop at runtime — re-implement the non-blocking part.

## Step 7 — Failure handling

- **Agent dies** (usage limit, crash): `git status`, remove its debris, reset its MCP status to `todo`, keep the CLI item pending, record what the next attempt needs. Don't relaunch into the same limit.
- **Agent stalls** (watchdog, no progress): `git status`. Wrote nothing → resume it via `SendMessage` (keeps context), telling it to keep tool calls short (one check per call, no long chained shell commands). Relaunch cold only if that fails.
- **Your own mistake** (overwrote a description, staged wrong paths): fix it at once, say so in one plain sentence next update — no drama, no re-litigation.
- **A check fails after a change that shouldn't affect it**: stop that task; never regenerate a baseline to make it pass. Re-baseline only as a deliberate, documented step proving everything outside the intended change identical.

## Step 8 — Report and ask for approval

Per landed task: a short update (verified, corrected, "uncommitted"). At the end: a changes table (task → files → checks → device-verified?), deploy results, review findings and fixes, what was skipped and why, assumptions made in the user's place, held-back questions — then **ask for approval to commit** what is uncommitted. It can share a message with the last breakpoint batch.

## Step 9 — Commit on approval

Approval: "lgtm", "commit", "approved", or approval of named tasks. Feedback instead → amend the uncommitted work, rebuild all, redeploy, ask again. On approval:

1. Apply the collected CLAUDE.md wording in one pass.
2. Rebuild every target if anything changed since the last build.
3. **Check the index**: `git diff --cached --name-status`. Agents' `git mv` / `git rm --cached` pre-stage changes; each commit holds exactly what it claims and builds on its own.
4. **One commit per approved task** in the project's style, review fixes, feedback and version bumps folded in. Tasks touching the same files, or approved as one, share a commit. The version file goes in the last commit so the tree ends clean. Unapproved work stays uncommitted.
5. `mcp__task-manager__setStatus(id, 'done')` per committed task, then **reconcile**: `getById` every task that entered the queue and confirm each committed one is `done` (agents set `in_progress` themselves; it's easy to close a task's neighbours but not the task).
6. Per committed task with an `epic` (from `getById`), `mcp__task-manager__addNote` on the epic: `"#NN done, commit <sha>. <anything the next child needs to know>"`. If a `setStatus(done)` carried `epicStatus`, report that the epic closed.
7. Report the commit hashes.

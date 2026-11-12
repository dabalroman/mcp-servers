---
name: implement
description: Implement todo tasks via subagents — one at a time, summary then go, OCR code review before relay, commit on lgtm. Args: "#NN" | fuzzy scope (e.g. "svg joiner") | empty for all.
---

# Implement

Work through `todo` tasks one at a time: simple ones inline, complex ones via a focused subagent, so the main context holds only coordination (task id, diff summary, user confirmation). No `/clear` needed.

## Usage

`/tm:implement [scope]` — `[scope]` is free-text and resolves as follows:

- **`#NN`** (e.g. `/tm:implement #87`) — implement that single task by id.
- **fuzzy scope match** (e.g. `/tm:implement eink`, `/tm:implement svg joiner`) — match the argument case-insensitively against scope tags returned by `mcp__task-manager__getAll`. Pick the scope whose tag contains every word in the argument (after lowercasing and stripping punctuation). If multiple scopes match, list them and ask the user to disambiguate. If none match, report and stop.
- **no argument** — implement across all scopes in `getNext` priority order.

## Workflow (repeat until queue is empty or user stops)

### Step 1 — Get next task

- `#NN`: fetch it. An `epic` → invoke the `tm:implement-as-coordinator` skill with `#NN` and stop; that skill runs the epic's children. Status not `todo` → report the actual status and stop.
- Otherwise call `mcp__task-manager__getNext`, narrowed by the resolved scope; it already returns an epic's children in `seq` order. Nothing returned → report "Queue empty" and stop.
- **Next task in `refinement` or `plan`** (`getNext` returns both): don't refine or plan inline. Report "Task #NN is in <status> — run `/tm:refine #NN` first" (or "finish and approve its plan first") and stop.

### Step 2 — Show summary, then go

Show the task (id, title, type, summary) and go to step 3. Don't ask whether to start or about per-phase commits: a task is one commit unless the user asks for per-phase commits.

### Step 3 — Set in_progress

`mcp__task-manager__setStatus(id, 'in_progress')` before anything else.

### Step 4 — Break into a task list

**Before writing any code**, read the task's description, plan and notes from `getById` (notes are as authoritative as the description; newest wins: newer note > older note > description) and decompose the work with `TaskCreate`, one reviewable unit per step (e.g. "Add `priority` column migration", "Add tests for priority filtering").

- Create **all steps up front** so the user sees the full checklist.
- Each step: imperative `subject`, short `description` (what changes, where), `activeForm` (e.g. "Adding priority column migration").
- Follow the plan's structure if there is one; otherwise derive steps from the description.
- 2–8 steps, always including "Run verify" and "Run OCR review" (a typo fix: "Apply fix" + those two); group a large feature to stay within ~8.
- `TaskUpdate` each step `in_progress` right before it, `completed` right after.

### Step 5 — Implement

**Per-phase commits** (only when the user asked): run steps 5–6 one phase at a time. A phase that passes verify and OCR is committed in the project's message style, naming the phase; if the task has an epic, note on it `"#NN phase K/N done, commit <sha>. …"`. No lgtm per phase. **Breakpoints — defer, don't stop**: a phase the user must test by hand (UI, device, their environment) or that waits on something only they do (a merge, a deploy) is parked (verified, reviewed, staged, uncommitted) while you continue every phase that doesn't depend on it; a phase sharing files with a parked one or building on it waits too. Name the breakpoints in the step-2 summary. Only when no phase can proceed, run steps 7–8 once for everything pending, saying per parked phase exactly what to test or do. Commit each parked phase after the user's lgtm, then resume the waiting ones. Feedback fixes on a committed phase are their own commit. The task stays `in_progress` until step 9.

**Classify the task.** **Simple** if ALL hold: ≤ 3 files; the fix is concrete (specific lines, specific change); no new architectural decisions; diff < ~50 lines. Otherwise **complex**.

**Simple → inline:** read the files, make the changes, add/update tests, run the project's verify command (from its CLAUDE.md, e.g. `npm run verify`; "verify" below means this).

**Complex → focused subagent:** pick the most specific type in the project's `CLAUDE.md` agent table. Pass: task id, title, full description, relevant file paths and line numbers, fix approach, the step-4 task IDs, and the instructions: read files → implement → mark each step completed as you go → add/update tests → run verify → report the diff summary and verify result.

### Debugging during implementation

When verify fails or behaviour is unexpected and the cause isn't obvious, **ask the user to add temporary debug logs** (which file, which line, what to log) and re-run — faster than guessing. Remove them before completing the step.

### Step 6 — Code review (OCR)

**Mandatory before relaying — no code is committed without it.** [open-code-review](https://github.com/alibaba/open-code-review) (`ocr`, global npm) in **delegation mode**: OCR picks files and per-language rules, you review. No OCR LLM/API key.

**Assume `ocr` is installed** — don't probe with `which`/`--version`, just run step 1. Only on `command not found` (exit 127): skip the rest of this step, tell the user verbatim **"Skipping code review, OCR not installed"**, carry that line into step 7, continue. Any other `ocr` error is not a skip — report and resolve it before relaying.

1. **Preview** — from the repo root: `ocr delegate preview --format json -b "<task #id title + one-line goal>"`. Workspace mode covers staged, unstaged and untracked changes. A `git ... older than the minimum supported version` warning is harmless.
2. **Scope** — keep only `reviewable_files` this task created or modified; unrelated pre-existing dirty files are `skipped: not part of this task`.
3. **Rules** — `ocr delegate rule --format json <path...>` for the in-scope files; apply each rule group's checklist to its files.
4. **Review every in-scope file** — tracked: `git --no-pager diff --no-ext-diff --no-textconv --no-color HEAD -- "<path>"`; untracked (`added`): read the whole file. Read surrounding code as needed; don't stop at the first finding. Each file ends `reviewed` or `skipped` with a concrete reason.
5. **Classify** each finding: `path:line`, category (bug, security, performance, maintainability, test, style, documentation), severity (critical, high, medium, low). Discard likely false positives.
6. **Address:** critical / high / medium → fix, re-run verify. Low → fix if trivial, else list for the user. A finding you deliberately don't fix (out of scope, contradicts the task/plan, false positive on reflection) stays in the report with the reason. After non-trivial fixes, re-run steps 1–5 once on the changed files.

For complex tasks the review runs in the main conversation after the subagent reports, not inside it — the reviewer shouldn't be the author.

### Step 7 — Relay to user

Summarise the changes, verify result and OCR summary (files reviewed/skipped, findings fixed, findings left open with reasons). Tell the user exactly what to test: golden path + edge cases from the task description.

### Step 8 — Wait for confirmation

**Stop here.** No commit (step-5 per-phase commits excepted), no next task, until the user confirms ("lgtm", "looks good", "ship it"). If they report a problem, fix it inline (simple) or via a follow-up agent (complex).

### Step 9 — Commit and close

Once the user confirms:

1. Stage and commit in the project's message style. **No `Co-Authored-By` line.** With per-phase commits, this commits only what is left (the last phase or feedback fixes).
   If the task-manager server instructions say this project tracks PRs and you opened a PR/MR for the task, record it: `mcp__task-manager__update({ id, prs: [...existing, { url, number, status }] })`.
2. `mcp__task-manager__setStatus(id, 'done')`. If the response carries `epicStatus` (the last child closed its epic), tell the user.
3. If the task has an `epic` (from `getById`), `mcp__task-manager__addNote` on it: `"#NN done, commit <sha>. <anything the next child needs to know>"`.
4. Back to step 1 (next task's summary, then start).

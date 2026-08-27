---
description: Implement todo tasks via subagents — one at a time, confirm before each, commit on lgtm. Args: "#NN" | fuzzy scope (e.g. "svg joiner") | empty for all.
---

# Implement

Work through `todo` tasks one at a time by delegating each to a focused subagent, keeping the main context lean. No `/clear` needed.

## Usage

`/implement [scope]` — `[scope]` is free-text and resolves as follows:

- **`#NN`** (e.g. `/implement #87`) — implement that single task by id.
- **fuzzy scope match** (e.g. `/implement eink`, `/implement svg joiner`) — match the argument case-insensitively against scope tags returned by `mcp__task-manager__getAll`. Pick the scope whose tag contains every word in the argument (after lowercasing and stripping punctuation). If multiple scopes match, list them and ask the user to disambiguate. If none match, report and stop.
- **no argument** — implement across all scopes in `getNext` priority order.

## Workflow (repeat until queue is empty or user stops)

### Step 1 — Get next task

- If `#NN` was passed: fetch that task. If its status is not `todo`, report the actual status and stop.
- Otherwise call `mcp__task-manager__getNext`, narrowed by the resolved scope. If nothing is returned, report "Queue empty" and stop.
- **If the next task is in `refinement`**: do NOT refine inline. Report "Task #NN is in refinement — run `/refine #NN` first" and stop. Strict separation between the two commands.

### Step 2 — Confirm with user

**Stop here.** Show the user the next task (id, title, type, description summary) and ask: "Start this task? (yes / skip / stop)".

- **yes** — proceed to step 3.
- **skip** — do NOT set the task `in_progress`; go back to step 1 to fetch the next one.
- **stop** (or any other negative) — halt the queue.

### Step 3 — Set in_progress

Call `mcp__task-manager__setStatus(id, 'in_progress')` before doing anything else.

### Step 4 — Break into a task list

**Always do this before writing any code.** Read the task's plan (if it has one) and description, then decompose the work into concrete steps using `TaskCreate`. Each step should be a single reviewable unit — e.g. "Add `priority` column migration", "Update `getAll` handler to accept filter", "Add tests for priority filtering".

Rules:
- Create **all steps up front** before starting the first one. The user should see the full checklist immediately.
- Each task gets a clear imperative `subject` and a short `description` saying what changes and where.
- Set `activeForm` on each task (e.g. "Adding priority column migration") so the spinner is informative.
- If the task-manager task has a `plan`, follow the plan's structure for the breakdown. If there is no plan, derive steps from the description.
- Aim for 2–8 steps. A single-file typo fix still gets at least "Apply fix" + "Run verify". A large feature should not exceed ~8 — group related changes.
- Mark each step `in_progress` (via `TaskUpdate`) right before you start it and `completed` right after.

### Step 5 — Implement

Work through the task list created in step 4, marking each step in_progress → completed as you go.

**Classify the task first:**

A task is **simple** if ALL of the following are true:
- touches ≤ 3 files
- the fix is described concretely (specific lines, specific change)
- no new architectural decisions needed
- estimated diff < ~50 lines

A task is **complex** if it touches many files, requires design decisions, spans multiple subsystems, or has a large estimated diff.

**Simple task → implement inline:**
Read the relevant files, make the changes, add/update tests, run `npm run verify`. Stay in the main conversation — no subagent needed.

**Complex task → spawn a focused subagent:**
Pick the most specific type from the project's `CLAUDE.md` agent table (e.g. `voltagent-lang:react-specialist`, `voltagent-lang:node-specialist`, `voltagent-core-dev:fullstack-developer`). Pass the agent: task id, title, full description, relevant file paths and line numbers, fix approach, the task list IDs for its steps, and these instructions: read files → implement → mark each TaskCreate step completed as you go → add/update tests → run `npm run verify` → report back with diff summary and verify result.

### Debugging during implementation

When a verify run fails or behaviour is unexpected and the root cause isn't obvious from the error alone:
- **Ask the user to add temporary debug logs** (e.g. `console.log` at key decision points) and re-run. This gives you live feedback from the actual code path and is faster than guessing. Frame the request concretely: which file, which line, what to log.
- Remove all debug logs before marking the step completed.

### Step 6 — Relay to user

Summarise what changed and the verify result. Tell the user exactly what to test (golden path + edge cases from the task description).

### Step 7 — Wait for confirmation

**Stop here.** Do not commit. Do not move to the next task. Wait for the user to confirm the change works (e.g. "lgtm", "looks good", "ship it"). If the user reports a problem, fix it inline (simple) or spawn a follow-up agent (complex).

### Step 8 — Commit and close

Once the user confirms:

1. Stage the changed files and commit with a clear message. **No `Co-Authored-By` line.**
2. Call `mcp__task-manager__setStatus(id, 'done')`.
3. Go back to step 1 (which will show the next task and ask for confirmation before starting it).

## Why this pattern works

Simple tasks are handled inline — fast and cheap. Complex tasks are delegated to subagents so the main context stays lean. The main conversation only ever holds coordination: task id, diff summary, user confirmation.

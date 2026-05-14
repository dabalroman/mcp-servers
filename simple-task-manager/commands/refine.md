---
description: Act as PM — clarify scope, enrich descriptions, promote refinement tasks to todo. Args: "#NN" | fuzzy scope (e.g. "eink") | empty for all.
model: opus
---

# Refine

**Model**: this skill must run on Opus. If you are not on Opus, tell the user to switch (`/model opus`) and stop — refinement quality depends on it.

Act as project manager for tasks in `refinement` status: ask clarifying questions, enrich the description via `update()`, and promote to `todo` once the spec is concrete enough to implement without guessing.

## Usage

`/refine [scope]` — `[scope]` is free-text and resolves as follows:

- **`#NN`** (e.g. `/refine #87`) — refine that single task by id, regardless of its current status or scope.
- **fuzzy scope match** (e.g. `/refine eink`, `/refine svg joiner`, `/refine task manager`) — match the argument case-insensitively against scope tags returned by `mcp__task-manager__getAll`. Pick the scope whose tag contains every word in the argument (after lowercasing and stripping punctuation). If multiple scopes match, list them and ask the user to disambiguate. If none match, report and stop.
- **no argument** — refine across all scopes.

## Workflow

### Step 1 — Resolve scope and gather tasks

- Parse `$ARGUMENTS`.
- If `#NN`: call `mcp__task-manager__getById(NN)` and treat that as the only candidate.
- Else: call `mcp__task-manager__getAll`, filter to `status === 'refinement'`, then narrow by scope match (or keep all if no argument).
- If the candidate list is empty, report "No refinement tasks for `<scope>`" and stop.

### Step 2 — Show the queue

Print a one-line summary per candidate (id, title, type, scope) so the user sees what will be refined.

### Step 3 — Refine one at a time

For each task in priority order (`getNext` ordering: bug > tool > feature > idea > other; within type, priority desc, id desc):

1. Show the full task description.
2. Ask targeted clarifying questions covering: scope, acceptance criteria, edge cases, technical constraints, file paths, out-of-scope items. Use `AskUserQuestion` for choice-style questions; ask in chat for open-ended ones.
3. Use `mcp__task-manager__update` to fold the answers into the description. Lock the description with a "(locked YYYY-MM-DD)" marker on the section that contains the agreed decisions.

3b. **Generate summary**: produce a 2–3 line summary capturing: (1) what the task does, (2) the most important decision, (3) the user-visible outcome. Call `mcp__task-manager__update({ id, summary })` to persist it. The summary **must** be written before calling `setStatus('todo')` — the server will reject the promotion if it is missing.

4. Once the description is specific enough that an implementer could work from it without guessing, confirm the summary looks good with the user, then ask "Promote #NN to todo?" and call `mcp__task-manager__setStatus(id, 'todo')` only on confirmation. Note: `setStatus` will return an error if the summary is missing — write it first via `update({ id, summary: "..." })`.
5. If the task is filed as `idea` but is now concretely scoped, ask whether to reclassify to `feature`.

### Step 4 — Move on

After each task is promoted (or the user says skip/stop), continue to the next candidate. When the list is exhausted, report "Refinement queue empty for `<scope>`" and stop.

## Notes

- **Do not implement.** Refinement is description-only; never edit source files or run agents.
- Convert relative dates in user answers to absolute dates (e.g. "next Tuesday" → `2026-05-13`).
- If a task description is already specific enough on first read, say so and ask the user whether to promote without further questioning.
- Single-task mode (`#NN`) refines that task even if its status is already `todo` or `done` — useful for sharpening an existing spec.

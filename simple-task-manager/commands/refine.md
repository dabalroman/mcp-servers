---
description: Act as PM — clarify scope, enrich descriptions, promote refinement tasks to plan or todo. Args: "#NN" | fuzzy scope (e.g. "eink") | empty for all.
model: opus
---

# Refine

**Model**: this skill must run on Opus. If you are not on Opus, tell the user to switch (`/model opus`) and stop — refinement quality depends on it.

Act as project manager for tasks in `refinement` status: ask clarifying questions, enrich the description via `update()`, and promote to `plan` or `todo` once the spec is concrete enough to implement without guessing.

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
3. Use `mcp__task-manager__update` to fold the answers into the description. Structure the description using the **Facts / Changes / Steps** format:

   ```
   Facts (current state)
   - [bullet per relevant fact about how things work today]

   Changes (what will be different)
   - [bullet per concrete change this task introduces]

   Steps (implementation order)
   1. [numbered steps in the order an implementer should execute them]
   ```

   Each section is a flat list of single-line items — no paragraphs, no nested bullets, no prose. Facts describe the world as-is (file paths, existing APIs, data formats, constraints). Changes describe the target state delta. Steps are an ordered checklist an implementer can follow top-to-bottom. Lock sections with a "(locked YYYY-MM-DD)" marker once agreed.

3b. **Generate summary**: produce a 2–3 line summary capturing: (1) what the task does, (2) the most important decision, (3) the user-visible outcome. Call `mcp__task-manager__update({ id, summary })` to persist it. The summary **must** be written before promoting to `plan` or `todo` — the server will reject the promotion if it is missing.

3c. **Pros/Cons analysis (offer)**: Once the description is solid, ask the user: "Want me to run a quick pros/cons analysis before promoting?" If yes, spawn two Sonnet agents in parallel:
   - **Advocate** (label: `advocate:#NN`): Enthusiastic about the change. Finds wins, surfaces benefits, identifies opportunities this unlocks. Prompt: "You are an optimistic senior engineer. Given this task description, argue FOR it: what problems does it solve, what doors does it open, what value does it deliver? Be specific and concrete. Under 200 words. Task: {title + description}"
   - **Skeptic** (label: `skeptic:#NN`): Grumpy and adversarial. Finds hidden costs, maintenance burden, complexity creep, things that will bite back in 6 months. Prompt: "You are a grumpy senior architect who has been burned before. Given this task description, argue AGAINST it: what are the hidden costs, what technical debt does it introduce, what will break or become painful in 6 months, what's being overlooked? Be specific and brutally honest. Under 200 words. Task: {title + description}"
   - Both agents use `model: "sonnet"`.
   - Present both reports to the user. Then **continue the refinement session** — treat the skeptic's concerns as new input, just like user answers in step 2:
     - Identify which concerns are real threats vs. speculative noise. State your assessment to the user.
     - For real concerns: propose how the task approach should change to address them. Discuss with the user — argue your position, push back if you disagree with the skeptic, but take valid points seriously.
     - Once aligned with the user, update the task description via `update()` so the spec itself reflects the decisions made (e.g. a different approach, a constraint, a scope reduction). Do NOT append a passive "Risks" section — the spec should read as if the concern was considered from the start.
     - Then proceed to step 3b (summary) as normal.

4. **Confirmation summary**: Once the description and summary are written and all concerns are resolved, print a structured wrap-up before asking about promotion. Format:

   ```
   Task #NN is fully refined. [If skeptic ran: "The skeptic's concerns are resolved:"]
   - [concern]: [resolution — one line each, e.g. "non-issue (verified X)", "handled with Y", "covered by task #MM", "not actionable (reason)"]

   Promote #NN to plan or directly to todo? [Your recommendation with reasoning, e.g. "Given the scope (multiple files, pattern-establishing), I'd lean toward plan so we map out the implementation order before coding."]
   ```

   If the skeptic/advocate step was skipped (user declined), omit the concerns list and just state "Task #NN is fully refined." followed by the promotion question with recommendation.

   Default to **todo** when unsure — `plan` is opt-in and only useful when the task needs a written implementation plan before coding starts. Call `mcp__task-manager__setStatus(id, 'plan')` or `mcp__task-manager__setStatus(id, 'todo')` only on confirmation. Note: `setStatus` will return an error if the summary is missing — write it first via `update({ id, summary: "..." })`.
5. If the task is filed as `idea` but is now concretely scoped, ask whether to reclassify to `feature`.

### Step 4 — Move on

After each task is promoted (or the user says skip/stop), continue to the next candidate. When the list is exhausted, report "Refinement queue empty for `<scope>`" and stop.

## Notes

- **Do not implement.** Refinement is description-only; never edit source files or run agents.
- Convert relative dates in user answers to absolute dates (e.g. "next Tuesday" → `2026-05-13`).
- If a task description is already specific enough on first read, say so and ask the user whether to promote without further questioning.
- Single-task mode (`#NN`) refines that task even if its status is already `todo` or `done` — useful for sharpening an existing spec.

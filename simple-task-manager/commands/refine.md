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

1. Show the full task description. If `getById` returns an `epic`, read it first (text and notes): keep the task's Goal and Steps consistent with the epic's order and rules, and flag any conflict to the user instead of silently diverging.
1a. **Product lens first.** Before any technical question, think about the task as a product decision, not a ticket, and write a short take in chat. Cover the points that apply:
   - **Who and why.** Who uses this, in what moment, and what job does it do for them? If the task only says *what* to build, name the user problem it serves. If you can't, that's the first question.
   - **What the user sees.** Describe the user-visible outcome in their terms: what changes in their day, what they stop doing, what they get back.
   - **How we'd know it worked.** Name one observable signal: they use it again, they edit less, a complaint stops. Prefer signals the product already records.
   - **Right problem, right size.**
     - Is this a symptom of a bigger gap?
     - Does something existing already cover it?
     - What is the smallest version that would prove the value?
     - Is the task solving the user's request or the user's need?
   - **Failure from the user's seat.** Where does it annoy, nag, add effort, break trust (wrong data saved, surprising behaviour), or leak privacy? Is it consistent with how the rest of the product already behaves?
   - **Adjacent ideas.** List 1–3 related ideas the task suggests: a read path for a write-only feature, a cheaper alternative, a follow-up it unlocks. Be generous here, since YAGNI applies to implementation, not refinement. **Don't widen this task's scope with them**; offer to file each one as a separate `idea` via `add()`.
   
   Fold the agreed answers into a one-line **Goal** at the top of the description (below). Skip the lens only for purely internal work (a refactor, a dependency bump, a docs fix), and say so.
2. Ask targeted clarifying questions covering: scope, acceptance criteria, edge cases, technical constraints, file paths, out-of-scope items. Use `AskUserQuestion` for choice-style questions; ask in chat for open-ended ones.
   - **Explain the reasoning first.** Before every round of questions, write in chat, per question: what the term or concept refers to, which fact from the task or codebase raises the question, and how each answer changes the spec. Only then call `AskUserQuestion`. Never ask a question whose context the user has not yet seen.
   - **Verify before you assert.** Every fact you present (in chat or in Facts) must come from opening its source: the file, the note, the log, the git history of the rule. A rule that looks like a bug may be deliberate, and a "missing" fact may already be there. If you got something wrong, correct the task and say so plainly.
   - **Check a user's constraint, don't just accept it.** When the user states a technical constraint ("X is too slow", "Y needs a native tool"), check it: measure it, read the code. Record the result as a fact, and push back with numbers if it doesn't hold.
3. Use `mcp__task-manager__update` to fold the answers into the description. Structure the description using the **Goal / Facts / Changes / Steps** format:

   ```
   Goal (user outcome)
   - [one line: who gets what, and how we'd know it worked]

   Facts (current state)
   - [bullet per relevant fact about how things work today]

   Changes (what will be different)
   - [bullet per concrete change this task introduces]

   Steps (implementation order)
   1. [numbered steps in the order an implementer should execute them]
   ```

   Each section is a flat list of single-line items — no paragraphs, no nested bullets, no prose. Goal is the user-visible outcome from step 1a (omit it for purely internal work). Facts describe the world as-is (file paths, existing APIs, data formats, constraints). Changes describe the target state delta. Steps are an ordered checklist an implementer can follow top-to-bottom. Lock sections with a "(locked YYYY-MM-DD)" marker once agreed.

3a. **Fold notes.** If `getById` returned `notes`, fold each into Facts/Changes/Steps — notes are as authoritative as the description and the newest statement wins on conflict (newer note > older note > description). Once the description reflects a note, remove it with `mcp__task-manager__deleteNote({ noteId })`.

3b. **Generate summary**: produce a 2–3 line summary capturing: (1) what the task does, (2) the most important decision, (3) the user-visible outcome. Call `mcp__task-manager__update({ id, summary })` to persist it. The summary **must** be written before promoting to `plan` or `todo` — the server will reject the promotion if it is missing.

3c. **Pros/Cons analysis (offer)**: Once the description is solid, ask the user: "Want me to run a quick pros/cons analysis before promoting?" If yes, spawn two Sonnet agents in parallel:
   - **Advocate** (label: `advocate:#NN`): Enthusiastic about the change. Finds wins, surfaces benefits, identifies opportunities this unlocks. Prompt: "You are an optimistic, product-minded senior engineer. Given this task description, argue FOR it. Cover the user first: what do they get, and why will they come back to it? Then cover what it unlocks next and what value it delivers. Be specific and concrete. Under 200 words. Task: {title + description}"
   - **Skeptic** (label: `skeptic:#NN`): Grumpy and adversarial. Finds hidden costs, maintenance burden, complexity creep, things that will bite back in 6 months. Prompt: "You are a grumpy senior architect who has been burned before and has watched users abandon features. Given this task description, argue AGAINST it. On the product side: will the user actually use this, where does it annoy or break trust, and is it solving the wrong problem or a symptom? On the engineering side: what are the hidden costs, what technical debt does it introduce, and what will be painful in 6 months? Be specific and brutally honest. Under 200 words. Task: {title + description}"
   - Pass the agents facts you have verified (numbers, usage, what shipped), not just the task text, and tell them which dirs are off-limits (private user data).
   - Both agents use `model: "sonnet"`.
   - Present both reports to the user. Then **continue the refinement session** — treat the skeptic's concerns as new input, just like user answers in step 2:
     - Identify which concerns are real threats vs. speculative noise. State your assessment to the user.
     - For real concerns: propose how the task approach should change to address them. Discuss with the user — argue your position, push back if you disagree with the skeptic, but take valid points seriously.
     - Once aligned with the user, update the task description via `update()` so the spec itself reflects the decisions made (e.g. a different approach, a constraint, a scope reduction). Do NOT append a passive "Risks" section — the spec should read as if the concern was considered from the start.
     - Then proceed to step 3b (summary) as normal.

4. **Confirmation summary**: Once the description and summary are written and all concerns are resolved, print a structured wrap-up before asking about promotion. Format:

   ```
   Task #NN is fully refined. Goal: [the one-line Goal].
   [If skeptic ran: "The skeptic's concerns are resolved:"]
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
- For a whole scope rather than one task (is it working for the user, what's next), use `/assess`.

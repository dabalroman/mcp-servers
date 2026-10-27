---
description: Product assessment of a scope — preserve and review real-usage evidence, record a go/no-go verdict, run a two-round advocate/skeptic debate at product level, synthesise ranked suggestions, file only what the user picks. Args: "#NN" (an evaluation task) | fuzzy scope (e.g. "vault ai") | empty to ask.
model: opus
---

# Assess

Step back from the task queue and judge a scope as a **product**. Is it doing its job for the user, what's weak from their seat, and what should come next? It ends in a recorded verdict and a short list of user-approved follow-up tasks.

**Model**: run on Opus. If you are not on Opus, tell the user to switch (`/model opus`) and stop.

**Do not implement.** The output is task-manager notes and new tasks. The only writes outside the task DB are copying evidence to the scratchpad and the memory update at the end.

## Usage

`/assess [scope]`:

- **`#NN`**: an existing evaluation task (e.g. "Judge the MVP after a week of real use"). Its description defines the checks, and its notes hold earlier trials.
- **fuzzy scope** (e.g. `/assess vault ai`): match against `getScopes()`, the same way as `/refine`. If there's no evaluation task, propose one via `add()` before Step 3 so the trials have somewhere to live.
- **no argument**: ask which scope.

## Workflow

### Step 1 — Gather the state

- `getById` / `getRelated(id, 'open')` and `getByScope(scope)`: what shipped, what's open, what's parked behind a "gate on the verdict".
- Read the scope's own CLAUDE.md and `git log --oneline` since the last assessment, or since the evaluation task was created.
- Note which fixes landed *between* trials. A trial only tests the code that was live when it ran, so record the commit each trial ran on.

### Step 2 — Preserve the evidence first

Usage artifacts include transcripts, run logs, output files, saved-vs-proposed diffs and UI history.
- **Before reading anything, check the scope's retention/TTL rules.** Copy every artifact you'll need into the scratchpad. A prune job can delete the baseline while you work.
- If the baseline is already gone, say so and drop the comparison. Don't fake one from memory.
- If the scope has no usage data (a library, a tool used rarely), the evidence is the task history, git log, notes, and the user's own reports. Say so explicitly.
- Respect privacy fences: if an artifact is private user content, read only what the evaluation needs, and never pass it to subagents.

### Step 3 — Review each trial against fixed checks

- Use the checks from the evaluation task. If it has none, derive 3–5 from the scope's core promise, for example:
  - does the main promise hold
  - wrong facts or output
  - wasted user effort
  - regressions of earlier fixes
  - shipped features that never triggered
- Log **one note per trial** in the same format each time: the date and commit, a line per check, and a short quote as evidence.
- **Verify every finding against its primary source before writing it.** Open the note, file, prompt or log line the finding is about.
  - "X is missing from the note": read the note.
  - "This breaks rule Y": grep for the rule *and* its origin in git history; it may be a deliberate rule that conflicts with another one.
  - "The feature never fires": find the trigger condition, then check whether any trial actually met it.
  - "The code is too slow": measure it.

### Step 4 — Get the user's verdict

- Ask for a one-line feel per batch of trials and an overall **continue / adjust / stop**. Put this in the trial notes in their words.
- The user's verdict is the decision, and your evidence informs it. If they disagree with your read, record both.

### Step 5 — The debate (two rounds, product altitude)

Spawn two Sonnet agents **in parallel, in the background**: an advocate and a skeptic. Both prompts must contain:
- **Altitude, stated up front:** "Argue about the product: what the user gets, why they'd stop using it, where trust breaks, what's missing. No code-structure points (god-files, refactors, test gaps) unless the user asked for a code review." If you leave this out, round 1 drifts into code review.
- **Read-only access plus the privacy fence** (which dirs not to read).
- **The facts:** what the scope is for, who uses it and how, the evaluation results with numbers (trial count, error counts, edit rates), and the open issues.
- **A word cap** (~350) and a closing "top 3" list (bets for the advocate, demands for the skeptic).

Round 2, via `SendMessage` to each (it resumes them):
- Give each agent the other's claims, labelled (a), (b), (c), to rebut or concede.
- Correct factual errors from round 1 that you verified yourself, e.g. "the evaluation did not only test an older system: trial 4 ran on X".
- Ask for a sharpened top 3.

While they run, do your own measurements: sizes, counts, rates, and where rules come from. Don't duplicate their reading.

### Step 6 — Synthesise

Write to the user:
1. **Where they agree**: 2–4 bullets.
2. **Where they disagree**: a table of `topic | advocate | skeptic | my call`, with a one-line reason per call. Side with whoever has the evidence, and split the call when both are half right.
3. **Spot-check the agents' factual claims** before relying on them. A skeptic's aside can expose a mistake in your own earlier findings. When it does, correct the task or note right away and say so.
4. **Ranked suggestions** in user-visible terms, including your own. Typical high-value shapes:
   - read paths: the product gives something back, not just collects
   - less effort per use
   - choosing by value instead of recency or randomness
   - closing the quality loop with the user's own corrections as the metric
5. **What you're not adopting**, and why: duplicates of existing tools, premature tooling at small n, points at the wrong altitude.

Then ask which suggestions to file.

### Step 7 — File only what the user picks

- One `add()` per accepted suggestion, at `refinement`, with `refs` to the evaluation task.
  - Type `idea` by default, `feature` when the user says it "should be done".
  - Priority as the user gives it.
- The description holds the idea, the **user's own words**, and the open questions *they* raised (channel, timing, data source). Those are the first things the next `/refine` settles.
- When the user adds a constraint later ("this needs a native tool, our code is slower"), check it against the code: measure, read, compare. Record the result as a note on the task. Agree or push back with numbers.
- Dismissed items are dropped. Don't re-argue or file them anyway.

### Step 8 — Close

- Write a **verdict note** on the evaluation task:
  - verdict and evidence base (n, date range, any missing baseline)
  - what worked
  - recurring flaws with their new task ids
  - what was deliberately not filed
  - the fate of every task that was gated on this verdict
- **Correct earlier notes in place** (`updateNote`) when later evidence overturns them. Don't append a contradicting note: a wrong trial note misleads every later reader.
- `setStatus(id, 'done')` once the user has accepted the verdict.
- Update the scope's memory/project note if the verdict changes how future sessions should treat the scope (e.g. "stays parked, don't propose without a concrete miss").

## Pitfalls (learned the hard way)

- **Confident findings that weren't true.** Both happened in the first run of this skill:
  - "New facts the agent failed to save" turned out to be already in the note.
  - "A rule violation" was a deliberate rule from an earlier commit.
  
  Open the source before filing. When you're wrong, correct the task, the notes and the summary, and tell the user plainly.
- **Retention ate the baseline.** Check TTLs in Step 2, not after.
- **The round-1 debate defaults to code review.** Set the altitude in the first prompt.
- **Small n means read by hand.** Six data points don't justify a mining tool. Say "read them", not "build a pipeline".
- **An unused feature isn't automatically a bug.** Check whether the trigger condition ever occurred before calling it broken. It may be a demand problem.
- **Keep the user's attention on decisions**: questions with options, and tables for disagreements. Not long transcripts of agent output.

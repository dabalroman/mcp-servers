---
name: assess
description: Product assessment of a scope — preserve and review real-usage evidence, record a go/no-go verdict, run a two-round advocate/skeptic debate at product level, synthesise ranked suggestions, file only what the user picks. Args: "#NN" (an evaluation task) | fuzzy scope (e.g. "vault ai") | empty to ask.
model: opus
---

# Assess

Judge a scope as a **product**: is it doing its job for the user, what's weak from their seat, what comes next? Ends in a recorded verdict and a few user-approved follow-up tasks.

**Model**: Opus only; otherwise tell the user to `/model opus` and stop.

**Do not implement.** Output: task notes and new tasks; the only other writes are scratchpad evidence copies and the closing memory update.

## Usage

`/tm:assess [scope]`:

- **`#NN`**: an evaluation task (e.g. "Judge the MVP after a week of real use"): description = the checks, notes = earlier trials.
- **fuzzy scope** (e.g. `/tm:assess vault ai`): match case-insensitively against `getScopes()` — the tag containing every word of the argument; several → ask, none → report and stop. No evaluation task → propose one via `add()` before Step 3 to hold the trials.
- **no argument**: ask which scope.

## Workflow

### Step 1 — Gather the state

- `getById` / `getRelated(id, 'open')`, `getAll({ scope })`: what shipped, is open, or is parked behind a "gate on the verdict".
- The scope's CLAUDE.md; `git log --oneline` since the last assessment (or the evaluation task's creation).
- A trial tests only the code live when it ran: note fixes landed *between* trials, record each trial's commit.

### Step 2 — Preserve the evidence first

Artifacts: transcripts, run logs, output files, saved-vs-proposed diffs, UI history.
- **Check retention/TTL rules before reading anything**; copy every needed artifact to the scratchpad — a prune job can delete the baseline mid-work.
- Baseline gone → say so, drop the comparison; don't fake one from memory.
- No usage data (a library, a rarely used tool) → evidence is task history, git log, notes, user reports; say so.
- Privacy fence: read only what the evaluation needs of private user content; never pass it to subagents.

### Step 3 — Review each trial against fixed checks

- The evaluation task's checks, or 3–5 from the scope's core promise (main promise holds? wrong facts/output, wasted user effort, regressions of earlier fixes, features that never triggered).
- **One note per trial**, fixed format: date and commit, a line per check, a short evidence quote.
- **Verify every finding against its primary source before writing it** (the first run filed "facts the agent failed to save" already in the note, and "a rule violation" that was a deliberate earlier rule):
  - "X is missing from the note": read the note.
  - "Breaks rule Y": grep the rule *and* its git-history origin; it may be deliberate, conflicting with another.
  - "Never fires": find the trigger condition, check whether any trial met it — unused may be a demand problem, not a bug.
  - "The code is too slow": measure it.
- Wrong → correct task, notes and summary; tell the user plainly.

### Step 4 — Get the user's verdict

- Ask a one-line feel per trial batch and an overall **continue / adjust / stop**; record it in the trial notes, their words.
- Their verdict decides; your evidence informs. If they disagree with your read, record both.

### Step 5 — The debate (two rounds, product altitude)

Spawn a Sonnet advocate and skeptic **in parallel, in the background**. Both prompts contain:
- **Altitude, up front** (left out, round 1 drifts into code review): "Argue about the product: what the user gets, why they'd stop using it, where trust breaks, what's missing. No code-structure points (god-files, refactors, test gaps) unless the user asked for a code review."
- **Read-only access plus the privacy fence** (dirs not to read).
- **The facts:** the scope's purpose, who uses it and how, evaluation numbers (trial count, error counts, edit rates), open issues.
- **A word cap** (~350) and a closing "top 3" (bets for the advocate, demands for the skeptic).

Round 2, `SendMessage` to each (resumes them):
- Each gets the other's claims, labelled (a), (b), (c), to rebut or concede.
- Correct verified round-1 factual errors ("the evaluation did not only test an older system: trial 4 ran on X").
- Ask for a sharpened top 3.

Meanwhile measure (sizes, counts, rates, rule origins); don't duplicate their reading.

### Step 6 — Synthesise

Keep the user on decisions (questions with options, tables), not agent transcripts.
1. **Where they agree**: 2–4 bullets.
2. **Where they disagree**: a `topic | advocate | skeptic | my call` table, one-line reason each. Side with the evidence; split when both are half right.
3. **Spot-check agents' factual claims** before relying on them. A skeptic's aside can expose your own mistake — correct the task or note at once, say so.
4. **Ranked suggestions** in user-visible terms, yours included. High-value shapes: read paths (giving back, not just collecting), less effort per use, choosing by value over recency or randomness, closing the quality loop with the user's corrections as the metric.
5. **Not adopting**, and why: duplicates of existing tools, wrong-altitude points, premature tooling at small n (six data points: "read them", not "build a pipeline").

Then ask which to file.

### Step 7 — File only what the user picks

- One `add()` per pick, at `refinement`, `refs` to the evaluation task; `idea` by default, `feature` if the user says it "should be done"; the user's priority.
- Description: the idea, the **user's own words**, the open questions *they* raised (channel, timing, data source) — what the next `/tm:refine` settles first.
- A constraint the user adds later ("needs a native tool, our code is slower"): check it (measure, read, compare), note the result on the task, agree or push back with numbers.
- Dismissed items are dropped: don't re-argue or file them.

### Step 8 — Close

- **Verdict note** on the evaluation task: verdict, evidence base (n, date range, missing baseline); what worked; recurring flaws with their new task ids; what was deliberately not filed; the fate of every task gated on this verdict.
- **Correct overturned notes in place** (`updateNote`), don't append a contradiction — a wrong trial note misleads every later reader.
- `setStatus(id, 'done')` once the user accepts the verdict.
- Update the scope's memory/project note if the verdict changes how sessions treat it (e.g. "stays parked, don't propose without a concrete miss").

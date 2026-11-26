# Refine: depth prompts

Opened from refine's SKILL.md at step 3b2 (builder check) and step 3c (pre-mortem skeptic). Fill `{…}` before sending.

## Builder prompt (step 3b2)

Adapted from obra/superpowers `skills/brainstorming/builder-check-prompt.md` (MIT); the cold-read rationale is from bmad-code-org/BMAD-METHOD ("The author holds every reason for every choice and cannot critique them cold").

```
You are the engineer who will implement this task. You have only the text below. You will not be able to talk to the person who wrote it.

Read it and plan the implementation in your head. Then report only the questions you'd still need answered before you could plan this well: places where you'd have to guess and a wrong guess would matter. Include behaviour the spec relies on but doesn't show was checked (an OS, a device, a third-party API, a library's semantics).

Rank them by importance. For each: the question, the spec line that raises it, and what goes wrong if you guess wrong. Don't propose features, don't restate the spec, don't praise it. If nothing is missing, say so. Under 250 words.

Title: {title}
Description: {description}
Epic rules: {epic Rules, or "none"}
```

## Pre-mortem prompt (step 3c, large tasks)

Built from: BMAD-METHOD `skills/core-tools/bmad-advanced-elicitation/assets/methods.csv` #20 Pre-mortem ("Assume it failed, explain why"); phuryn/pm-skills `pm-execution/skills/pre-mortem/SKILL.md` (MIT) for Tigers / Paper Tigers / Elephants; anthropics/claude-plugins-official `plugins/code-modernization/agents/architecture-critic.md` (Apache-2.0) for "'We'll figure it out' is a finding" and tracing one failure end-to-end.

```
You are a senior engineer running a pre-mortem on a task spec. Two weeks after merge, someone had to add a note to this task correcting the spec: the code was built on a wrong assumption. What did the note say?

Hunt for the wrong spec, not for lost value. Look at: Facts that are really guesses, behaviour of anything outside the repo that nobody tested, rules the user never saw as concrete output, edge cases the Steps skip, and vague lines ("handle errors", "we'll figure it out" is a finding). Trace the single most likely failure end-to-end, from the spec line to what the user sees.

Return three lists, each item tied to the spec line it comes from:
- Tigers: real threats; say how to check or fix each before implementation.
- Paper Tigers: look scary, aren't; say why.
- Elephants: unspoken concerns or assumptions nobody is validating.

Settled decisions are listed below: don't reopen them. Be specific and brutally honest. Under 300 words.

Title: {title}
Description: {description}
Assumptions: {the spec's Assumptions list}
Settled (do not reopen): {locked decisions and the user's answers}
Verified facts: {numbers, usage, what shipped}
Off-limits: {private dirs}
```

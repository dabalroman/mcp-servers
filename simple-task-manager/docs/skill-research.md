# Skill research (#686, epic #687)

Ideas from community-praised Claude Code skill repos and Anthropic posts for improving `/tm:refine`, `/tm:implement-as-coordinator` and `/tm:implement`. Each idea is ranked by how well it fixes a failure the user has observed (2026-11-26):

- **refine** misses the depth of the problem. This shows up as notes added after promotion.
- **coordinator** uses one or two agents and never actively searches for solutions or tools, such as Playwright.
- **implement** is "fine, could be improved".

Researched 2026-11-26. Stars, forks, dates and licences come from api.github.com at that date.

## Headline picks

- **refine (#688):**
  1. Assumptions ledger: unverified high-impact assumptions block promotion.
  2. Cold builder check.
  3. Probe the outside mechanism during refinement.
  4. Pre-mortem skeptic.
  5. Lay out 2–3 approaches.

  Ideas 2–5 apply to large tasks only. Longer prompts go in `refine/reference/depth.md`.
- **coordinator (#689):**
  1. Every task gets an evidence line, and the coordinator gathers runtime evidence itself (Playwright, a real request, a real run).
  2. Capability inventory before dispatch.
  3. Stuck means research in parallel, not retry.
  4. Two-tier fan-out: at most 2 editing agents on separate files, 3–5 read-only agents.

  The details go in a reference file.
- **implement (#690):** a ~215-word do/don't guide.
  - Read the real check output.
  - Compare a report against `git diff`.
  - Find the root cause first, and stop after three failed fixes.
  - Start a bug fix with a failing test.

## Replay picks

- **refine:** #662 and #670, which have verified corrections added after promotion. #660 and #673 are extras.
- **coordinator:** epic #553 and epic #470.
- **implement:** #560.


---

# Part: refine

## /tm:refine — community techniques for catching depth before promotion

Yardstick: notes added after promotion that correct the spec (the user's words: "better to think longer than fix the code built of wrong assumptions"). I sampled two real cases to use when replaying old vs new:
- **#662** (stylus mapping): the spec assumed that writing the Wisp registry entry applies the mapping. Note "verify FAILED" said it did not: the mapping is applied only during Lenovo's connect sequence. Nobody had tested the mechanism before promotion.
- **#670** (overall standings): a "qualification + win-rate" ranking rule was locked. The user overrode it after the build ("one big round, no % column"). The rule was never shown to the user as concrete output.

The baseline already covers the product lens, verify-before-assert, checking the user's constraints, an epic split and an optional Sonnet advocate/skeptic. The ideas below are only what it lacks.

### Sources

Stats are from `api.github.com/repos/...` on 2026-11-26.

| Repo | Stars | Forks | Created | Pushed | Licence | Kind |
|---|---|---|---|---|---|---|
| obra/superpowers | 326,643 | 28,986 | 2025-10-09 | 2026-11-24 | MIT | community |
| mattpocock/skills | 332,926 | 27,994 | 2026-02-03 | 2026-11-25 | MIT | community |
| github/spec-kit | 151,388 | 13,612 | 2025-08-21 | 2026-11-25 | MIT | official (GitHub) |
| anthropics/claude-plugins-official | 48,235 | 5,048 | 2025-11-20 | 2026-11-25 | Apache-2.0 | official (Anthropic) |
| bmad-code-org/BMAD-METHOD | 55,753 | 6,211 | 2025-04-13 | 2026-11-25 | NOASSERTION | community |
| phuryn/pm-skills | 28,321 | 2,910 | 2026-03-01 | 2026-11-08 | MIT | community |

Checked and not cited: anthropics/skills (200k stars, licence None; nothing on specs), anthropics/claude-code (plugins moved to the official repo), wshobson/agents (42.9k stars, MIT; its agents are role personas with no elicitation method), hesreallyhim/awesome-claude-code (a list only), boshu2/agentops (460 stars), Sorbh/interview-me (64), amplitude/builder-skills (167, stale since 2026-07).

### Ideas (ranked)

#### 1. Assumptions ledger: a load-bearing guess is never filed as a Fact
- **Sources:**
  - spec-kit `templates/commands/specify.md`: "Use reasonable defaults for unspecified details (document assumptions in Assumptions section)", plus a check that "Dependencies and assumptions identified".
  - BMAD `skills/core-tools/bmad-advanced-elicitation/assets/methods.csv` #7 Assumption Audit: "List every assumption, rate it, stress the weakest".
  - pm-skills `pm-product-discovery/skills/identify-assumptions-existing/SKILL.md`: rate each one for confidence, with a "suggested way to test it".
- **Failure it fixes:** today Facts mixes things that were verified with things that were inferred, so a wrong inference reads as settled. Each Facts line would be marked `(verified: source)` or moved to a short **Assumptions** list rated impact × confidence. Before promotion, every high-impact assumption must be verified, probed (idea 3), or put to the user. #662's "writing the key applies the mapping" would have been an Assumption and been blocked.
- **Cost:** about 80 words.
- **Slot:** step 3 format (a fifth section, or a tag on Facts) and a gate in step 5.

#### 2. Cold builder check before promotion
- **Source:** superpowers `skills/brainstorming/builder-check-prompt.md`: "You will not be able to talk to the person who wrote it… Report only the questions you'd still need answered before you could plan this well: places where you'd have to guess and a wrong guess would matter… Rank them by importance."
  - The answers are sorted into three piles: *answered already* (write it into the spec), *minor* (settle it and mark it as your call), *theirs* (one batched question to the user).
  - The rationale comes from BMAD: "The author holds every reason for every choice and cannot critique them cold."
- **Failure it fixes:** the refiner reads the spec with the whole conversation in mind, so gaps don't show. A fresh agent sees only the description, which is exactly what `/tm:implement` sees. That is where the guesses behind the post-promotion notes get made.
- **Cost:** about 70 words in SKILL.md, with the prompt in a reference file.
- **Slot:** new step 3b′, after the description and before 3c. Mandatory for large tasks, offered for small ones. It requires relaxing the "no agents other than 3c" rule.

#### 3. Probe the mechanism, don't just reason about it
- **Sources:**
  - superpowers brainstorming, "Spike to feel things out": "A quick throwaway build is often the cheapest way to learn what they want or whether something works."
  - mattpocock `skills/engineering/prototype/SKILL.md`: "throwaway code that answers a question… Capture the answer too (the verdict and the question it settled)."
- **Failure it fixes:** when a Change relies on behaviour outside the repo (an OS, a device, a third-party API, a library's semantics), reading code cannot confirm it.
  - Either run a read-only or `/tmp` throwaway probe during refinement and record the result as a verified Fact,
  - or, if the probe needs real implementation, make Step 1 "probe X; stop and note if it fails".
  - That would have caught #662 before promotion. It stays compatible with "do not implement" because nothing goes into the repo.
- **Cost:** about 60 words.
- **Slot:** step 2, as a sibling of "check a user's constraint".

#### 4. Pre-mortem replaces the generic skeptic, with a cold brief
- **Sources:**
  - BMAD methods.csv #20 Pre-mortem: "Assume it failed, explain why… what in the draft made it likely".
  - pm-skills `pm-execution/skills/pre-mortem/SKILL.md`: Tigers (real), Paper Tigers (overblown), Elephants ("unspoken concerns or assumptions nobody is validating").
  - Official `plugins/code-modernization/agents/architecture-critic.md`: "'We'll figure it out' is a finding… Trace one failure mode end-to-end."
- **Failure it fixes:** the current skeptic argues against *value* ("will the user use this"). The failure here is a *spec that is wrong*. Retarget the prompt: "Two weeks after merge, someone had to add a note correcting this spec. What did it say?"
  - The agent returns Tigers, Paper Tigers and Elephants, each tied to a spec line.
  - Its brief carries the Assumptions list from idea 1 and the settled decisions, so it doesn't reopen them (BMAD's "What is settled" brief part).
  - Run it on Opus for large tasks.
- **Cost:** about +40 words net (it rewrites the skeptic prompt).
- **Slot:** 3c.

#### 5. Lay out 2–3 approaches before writing Changes
- **Sources:**
  - superpowers brainstorming, "Lay out the approaches": "Come up with several real alternatives and drop the weak ones… Sketch the two or three that remain… Recommend one and say why."
  - Official `plugins/feature-dev/commands/feature-dev.md` Phase 4: parallel architects with "minimal changes… clean architecture… pragmatic balance".
- **Failure it fixes:** "better solutions, thinking outside the box". Today the refine flow goes straight from questions to one Changes list, and the first idea wins by default. An Approaches line in Facts ("considered X, Y; chose Z because") also stops `/tm:implement` from rediscovering a rejected path.
- **Cost:** about 60 words.
- **Slot:** between 2 and 3, for large tasks only.

#### 6. Design-tree frontier, with an end condition (strong runner-up)
- **Source:** mattpocock `skills/productivity/grilling/SKILL.md`: "Map this as a design tree… The frontier is every decision whose prerequisites are already settled… give your recommended answer… The session is done when the frontier is empty: every branch… visited, nothing left silently assumed."
  - It also says "Finding facts is your job, never the user's… dispatch a sub-agent", without blocking the rest of the round.
- **Failure it fixes:** step 2 has no completeness criterion, so a large feature can be promoted with branches never visited.
- **Cost:** about 70 words.
- **Slot:** step 2.
- **Optional pairing:** spec-kit `clarify.md`'s coverage taxonomy (each category marked Clear, Partial or Missing: data lifecycle, failure modes of external dependencies, concurrency and conflicts, scale assumptions…), as a reference file for checking the tree.

#### 7. Run concrete scenarios through the spec and show the user sample output
- **Source:** mattpocock `skills/engineering/domain-modeling/SKILL.md`: "stress-test them with specific scenarios… force the user to be precise about the boundaries", and "When the user states how something works, check whether the code agrees."
- **Failure it fixes:** #670. A worked example ("3 turns, these results, here is the table you'd get") would have prompted "no, one big round" before promotion.
- **Cost:** about 40 words.
- **Slot:** step 2.

#### 8. Parallel explorers for large tasks
- **Source:** feature-dev Phase 2: "Launch 2-3 code-explorer agents in parallel… Target a different aspect… then read all files identified".
- **Cost:** about 50 words.
- **Slot:** step 1, before 1a.

#### Recommendation
- Adopt ideas **1, 2, 3, 4 and 5**, behind one size gate.
  - **"Large"** means a task that spans more than one repo, more than about 3 files, relies on an external mechanism, or sets a new pattern.
  - Small tasks pay only idea 1 (about 80 words).
- **Word budget:** about 80+70+60+40+60 = 310 words, plus about 30 for the gate, which is close to the +363-word cap (20% of 1816).
  - Put the builder-check and pre-mortem prompts, and spec-kit's taxonomy, in `refine/reference/depth.md`.
  - Fold 7 into 3 as one sentence if there is room. Keep 6 and 8 as next candidates if the replay shows misses on unvisited branches.
- **Replay:** run #662 and #670 through old vs new. Success means the new skill raises "mapping applies only during the connect sequence" or "probe it", and "show a sample ranking", before promotion.

### Rejected

- **spec-kit's 5-question session cap:** it limits depth, the opposite of this goal.
- **spec-kit's hooks, scripts and spec files:** these are process scaffolding with no effect on assumptions.
- **BMAD's full multi-round elicitation (method catalog, session folders, `uv` scripts):** too heavy. Only the cold-brief principle is kept (ideas 2 and 4).
- **pm-skills' launch-blocking / fast-follow / track urgency tiers:** they suit a product launch, not a task spec.
- **superpowers' visual companion:** off-target. UI mockups already have their own flow (Penpot) in these projects.
- **mattpocock's GLOSSARY.md and ADR files:** repo artifacts, outside a task spec. It would also widen the skill's write surface.
- **superpowers writing-plans step granularity and Review Focus:** these belong to the `plan` status and `/tm:implement`, not refine.
- **feature-dev's "present all questions, wait for answers":** the baseline already does this.
- **The `ultrathink` / "think harder" keyword:** it adds reasoning budget but no structure aimed at assumptions, and refine already requires Opus.
- **agentops' four-judge pre-mortem and interview-me / spec-interviewer skills:** tiny repos, and their ideas are covered by 2, 4 and 6.

---

# Part: coordinator

## Coordinator skill research (#686 / epic #687)

Baseline: `implement-as-coordinator/SKILL.md` (2607 words, cap ≈3130). It already has: never-trust-a-report, re-run checks, negative tests for fixes, per-task model choice, lane boundaries, stall/death handling, sonnet review fan-out in Step 6, `modern-web-guidance` in briefs. **Missing:** any step that inventories tools/skills/MCP, any runtime/UI evidence beyond host checks, any "stuck → research" path, and a fan-out rule that tells cheap read-only agents apart from editing agents (today: "max ~2 — each costs a full agent context").

### Sources

| Source | Kind | Stars / forks | created → pushed | Licence |
|---|---|---|---|---|
| [Anthropic: multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) | official post | – | – | – |
| [Anthropic: effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | official post | – | – | – |
| [Anthropic: building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | official post | – | – | – |
| [Claude Code best practices](https://code.claude.com/docs/en/best-practices), [sub-agents](https://code.claude.com/docs/en/sub-agents), [skills (/run, /verify)](https://code.claude.com/docs/en/skills) | official docs | – | – | – |
| anthropics/claude-plugins-official (feature-dev, code-review) | official | 48,235 / 5,048 | 2025-11-20 → 2026-11-25 | Apache-2.0 |
| anthropics/claude-code | official | 157,097 / 25,119 | 2025-02-22 → 2026-11-26 | none |
| obra/superpowers | community | 326,643 / 28,986 | 2025-10-09 → 2026-11-24 | MIT |
| wshobson/agents (agent-teams plugin) | community | 42,896 / 4,543 | 2025-07-24 → 2026-11-24 | MIT |
| hesreallyhim/awesome-claude-code | community index | 58,815 / 5,024 | 2025-04-19 → 2026-11-26 | NOASSERTION |
| ruvnet/ruflo (ex claude-flow) | community | 82,426 / 9,712 | 2025-06-02 → 2026-11-25 | MIT |
| SawyerHood/dev-browser | community | 6,758 / 444 | 2025-12-02 → 2026-11-03 | MIT |
| OneRedOak/claude-code-workflows | community | 3,925 / 558 | 2025-08-12 → 2026-10-09 | MIT |

### Ideas (ranked by impact on the observed failure)

#### 1. Evidence plan per task: drive the real thing, not only host checks (verification). ~120 words. Steps 1.5 + 2 + 3.
- **Source:** effective-harnesses post: Claude had "a tendency to mark a feature as complete without proper testing" and relied on unit tests or curl; once "explicitly prompted to use browser automation tools and do all testing as a human user would", performance "dramatically improved". Best practices: a check can be "a browser screenshot next to the mockup"; "ask Claude for *evidence*: the command it ran and its output, or the screenshot"; `/verify` "build[s] and run[s] your app … without falling back to tests or type checks".
- **Proposal:** in Step 1.5 every queued task gets an **evidence line**: what proves it works at runtime (UI → headless-browser screenshots at desktop + phone widths plus a DOM/console assertion; API → a real request against the dev server; CLI → a real run on a fixture). The brief demands that evidence (paths to screenshots, request/response) in the hand-back, and Step 3 adds "3b. gather the runtime evidence yourself, or open the agent's screenshots and look at them." A breakpoint is declared only once self-gathered evidence is exhausted, so the user tests what an agent can't see (a device, their data), not what Playwright could have shown.
- **Recommendation: adopt.** This is the verification half of the failure, and the coordinator has nothing like it now: Step 3 re-runs host-side checks only.

#### 2. Capability inventory before dispatch (tool-searching). ~110 words. New Step 1.0b; also passed into Step 2 briefs.
- **Source:** multi-agent research post, tool heuristics: "examine all available tools first, match tool usage to user intent", and "an agent searching the web for context that only exists in Slack is doomed from the start". superpowers `using-superpowers`: "If you think there is even a 1% chance a skill might apply … you ABSOLUTELY MUST invoke the skill" (too strong to copy as is, but it shows how to phrase the trigger).
- **Proposal:** once per run, list what is available: installed skills (`run`, `verify`, `find-skills`, `code-review`, domain skills), MCP servers (ToolSearch for deferred tools: browser, Chrome), host tools named in CLAUDE.md or memory (e.g. a global Playwright install), and web search. Write a 3–6-line "Tools for this queue" block into the queue message and each brief ("for UI evidence use X; for an unknown third-party symptom use WebSearch first").
- **Recommendation: adopt.** It is cheap and directly fixes "never actively searches for solutions". It also makes idea 1 work: you can't demand Playwright evidence until you know Playwright is installed.

#### 3. Stuck → research fan-out, not retry (tool-searching + fan-out). ~120 words. Step 7 (new bullet) and Step 3.2.
- **Source:** superpowers `handling-reports.md`: "**Never** ignore an escalation or force the same model to retry without changes. If the implementer said it's stuck, something needs to change": add context, use a stronger model, split the task, or correct the plan. `systematic-debugging`: "If ≥ 3 [fixes failed]: STOP and question the architecture". wshobson `parallel-debugging`: competing hypotheses, each investigated by its own agent with an evidence-strength table (direct > correlational > testimonial).
- **Proposal:** when an agent reports BLOCKED, or a check fails twice for an unclear reason, launch 2–3 **read-only research agents in parallel**, each with one hypothesis or one angle: (a) web-search the exact error or symptom, (b) find how the repo or its siblings already solve it, (c) check whether an installed skill or MCP tool covers it. Feed the findings back with `SendMessage` to the stuck agent, or re-dispatch with the ruling.
- **Recommendation: adopt.** It turns "one or two agents" into deliberate fan-out exactly where it pays off.

#### 4. Two-tier fan-out rule: read-only agents are cheap, editing agents are capped (fan-out). ~90 words. Replaces Step 1.3's "max ~2".
- **Source:** research post: "Simple fact-finding requires just 1 agent with 3-10 tool calls … complex research might use more than 10 subagents"; the lead "spins up 3-5 subagents in parallel". But also: "most coding tasks involve fewer truly parallelizable tasks than research". superpowers SDD: "Never dispatch multiple implementation subagents in parallel (conflicts)". feature-dev: "Launch 2-3 code-explorer agents in parallel", then "read all files identified by agents". Best practices: Haiku "is a good fit for subagents doing simple jobs"; Explore takes "quick / medium / very thorough".
- **Proposal:** **Editing agents:** keep max 2, on disjoint lanes (same rule as today). **Read-only agents** (Explore, research, verify/screenshot, review) are not capped by that rule: use up to 3–5 in parallel when their angles really differ, give them a cheaper model, and have them return file lists or conclusions, not dumps. Also: the research post found that multi-agent runs use "about 15× more tokens than chats", so scale the number of agents to the task's complexity and don't launch them by default.
- **Recommendation: adopt.** The evidence backs the current editing cap. It argues against applying that cap to read-only work.

#### 5. Pre-dispatch scouting for under-specified or cross-cutting tasks (fan-out). ~70 words. Step 1.4, next to stale-plan reconciliation.
- **Source:** feature-dev Phase 2: explorers each "target a different aspect … Include a list of 5-10 key files to read". Research post: "start with short, broad queries, evaluate what's available, then progressively narrow focus".
- **Proposal:** for `opus`-class tasks, run 1–2 Explore agents first ("similar features and how they're tested", "which runtime checks exist for this area"). Put the file list they return, and any existing verification harness, into the brief. This makes briefs sharper and feeds idea 1.
- **Recommendation: adopt, scoped to opus-class tasks only.**

#### 6. Brief contract: objective, output format, tools to use, boundaries; artifacts as files (dispatch quality). ~60 words. Step 2 brief list.
- **Source:** research post: "Each subagent needs an objective, an output format, guidance on the tools and sources to use, and clear task boundaries", and vague briefs make agents "duplicate work, leave gaps". SDD: "Hand artifacts over as files"; a dispatch that "hit 42k chars of which 99% was pasted history".
- **Proposal:** add the missing piece to the existing brief list: "**tools to use**", taken from idea 2's block. Add "screenshots and long logs go to `/tmp/<task>/…`; report paths, not contents".
- **Recommendation: adopt.** The list already covers objective, output and boundaries, so this is a two-line addition.

#### 7. Independent verification of review findings (verification). ~50 words. Step 6.3.
- **Source:** official code-review command: "For each issue found … launch parallel subagents to validate the issue … with high confidence", and "If you are not certain an issue is real, do not flag it."
- **Proposal:** Step 6.3 already says "verify each finding against the code". Allow parallel validator agents for batches of findings over about 5 instead of checking them all inline.
- **Recommendation: optional.** It helps the review step's fan-out but does nothing for the failure the user observed.

**Budget:** ideas 1–6 come to about 570 words. That is too many next to 2607 + 20% (≈520 headroom). Put the full wording of the idea-1 evidence menu (per task kind) and the idea-3 research recipe into `references/evidence-and-research.md`, and keep about 250–300 words in SKILL.md.

### Rejected (considered)

- **Superpowers' "1% chance → MUST invoke" wording:** too absolute; in a coordinator it would trigger skill calls on every step. Idea 2 keeps the intent with a single inventory pass.
- **Agent Teams / tmux team presets (wshobson agent-teams), ruflo swarms and its MCP memory layer:** heavy frameworks, and a new dependency. They overlap with the native Agent + SendMessage tools, and the user's rule bans worktrees.
- **Worktree-per-agent isolation (superpowers SDD, best practices "Run sessions in parallel"):** banned by the user's global rules. Lane boundaries plus staging already cover it.
- **Implementer commits per task plus a ledger file (SDD):** conflicts with "coordinator commits only on approval". The CLI todo list plus MCP notes already act as the ledger.
- **Ask clarifying questions and wait (feature-dev Phase 3) / approve the architecture choice:** conflicts with "ask nothing mid-run".
- **Three competing architecture designs per task (feature-dev Phase 4):** tasks arrive refined and locked, so this spends tokens without changing the outcome.
- **Spec-compliance reviewer after every task (SDD):** duplicates the OCR review the implementer already runs plus Step 3's diff read.
- **Third-party browser plugins (dev-browser, ProofShot, showreel):** a global Playwright install on the host already covers this. Write the evidence rule against "headless browser available per CLAUDE.md/memory" instead of a specific plugin.
- **`/goal` or Stop-hook enforcement:** harness config, not skill text, and the run is supervised by the coordinator anyway.
- **JSON feature list with a `passes` field (harness post):** the MCP task status plus CLI items already serve this purpose.

---

# Part: implement

## Research: improving /tm:implement (task #686)

### Sources
| Source | Type | Stars / forks | created / pushed | Licence |
|---|---|---|---|---|
| code.claude.com/docs/en/best-practices (old anthropic.com/engineering URL 308s here) | Official docs | n/a | n/a | n/a |
| github.com/obra/superpowers (verification-before-completion, systematic-debugging, test-driven-development, executing-plans) | Community | 326,643 / 28,986 | 2025-10-09 / 2026-11-24 | MIT |
| github.com/multica-ai/andrej-karpathy-skills (CLAUDE.md; forrestchang/ redirects here) | Community, Karpathy-derived | 235,721 / 23,376 | 2026-01-27 / 2026-04-20 | none declared |
| youmind.com "Karpathy's 4 rules... I added 8 more" | Community article | n/a | n/a | n/a |
| github.com/anthropics/claude-code | Official | 157,097 / 25,119 | 2025-02-22 / 2026-11-26 | none declared. plugins/feature-dev path 404s (dir now just README); not used |
| hesreallyhim/awesome-claude-code | Community index | 58,815 / 5,024 | 2025-04-19 / 2026-11-26 | NOASSERTION. Index only, no rule text taken |
| anthropics/claude-plugins-official | Official | 48,235 / 5,048 | 2025-11-20 / 2026-11-25 | Apache-2.0. Not mined |

### Rules (ranked)
Word cost = words in the draft guide. "Gap" = what SKILL.md lacks.

1. **Evidence before "done"**: read the verify output and exit code in this session; no "should/probably". Quote: "NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE." (superpowers/verification-before-completion). Docs: "'All tests pass' on its own tells you very little" (best-practices). Prevents: stale or assumed green, relaying unverified subagent claims. Gap: SKILL runs verify but never demands output be read or subagent reports checked against the diff. ~25w.
2. **Verify a subagent's report against `git diff`**, don't trust its summary (superpowers). Prevents: claimed-but-absent changes. Gap: step 7 relays the subagent's summary. ~15w.
3. **Root cause before fix**: "NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST"; one hypothesis, one change at a time (superpowers/systematic-debugging). Prevents: stacked speculative fixes. Gap: SKILL's debugging section only says ask for logs. ~25w.
4. **Three failed fixes = stop and question the approach with the user** (systematic-debugging); docs say the same at two failed corrections. Prevents: thrash loops. Gap: none in SKILL. ~20w.
5. **Bug fix starts with a reproducing test that fails first**; a regression test must be seen red then green (karpathy "write a test that reproduces it"; superpowers "fix without a test that failed first is not verified"). Prevents: tests that can't catch the bug. Gap: SKILL only says "add/update tests". Soften: bugs only, not an all-code TDD iron law. ~20w.
6. **Read before write**: check exports, callers and shared utilities; reuse the existing helper (youmind rule 8). Prevents: duplicate functions. Gap: SKILL says "read the files" only. ~15w.
7. **Match existing conventions even if you'd choose differently; when two patterns conflict pick one and flag the other** (youmind rules 7, 11). Prevents: a second pattern. ~20w.
8. **Tests verify intent**: they must fail if the logic changes (youmind rule 9). Prevents: constant-return tests. ~12w.
9. **Fail loud**: state skipped or uncertain items; never call partial work complete (youmind rule 12; superpowers "Ruling" ledger). Prevents: silent skips. ~15w.
10. **State assumptions; when the spec has two readings, surface both, don't pick silently** (karpathy). Prevents: building the wrong thing. SKILL has no ask-on-ambiguity rule inside step 5. ~18w.
11. **Review findings: don't chase style**; "A reviewer that's asked to find problems will always find something... extra abstraction layers and tests for cases that can't happen." (best-practices). Prevents: gold-plating after OCR. SKILL already fixes only med+ but low "fix if trivial" invites it. ~15w.
12. **Rulings, not stalls**: only stop for destructive, security-sensitive, outside-worktree side effects or a hopelessly broken plan; log other deviations as one-line rulings (superpowers/executing-plans). Prevents: needless pauses and silent deviation. Fits the step-2 "don't ask, go" style. ~25w.
13. **Verify the real app for UI/behaviour, not just tests** ("catches the kind of problem that tests and typechecks miss", best-practices /verify). Repo memory already has "look at UI before handback", so partly covered.

### Draft guide (about 215 words)
#### Do and avoid while implementing
**Before coding**
- Read the callers, exports and shared helpers of every file you touch; reuse what exists.
- Match the codebase's conventions even when you would choose differently. If two patterns conflict, pick one and flag the other.
- If the spec reads two ways, state both and ask. Don't pick silently.

**While coding**
- A bug fix starts with a test that reproduces it and fails. See it fail, then pass.
- Tests must fail if the behaviour changes. A test that passes on a constant proves nothing.
- Unexpected failure: find the root cause before changing code. One hypothesis, one change at a time.
- After three failed fixes, stop and question the approach with the user.
- Deviating from the plan or notes: log one line (what, why, cost if wrong) in the relay. Stop only for destructive, security-sensitive or outside-the-repo actions.

**Before relaying**
- Read verify's actual output and exit code from this run. "Should pass" is not evidence.
- Check any subagent's claims against `git diff`. Never relay its summary unchecked.
- Say what you skipped or are unsure of. Never call partial work complete.
- Review findings: fix correctness issues. Don't add abstractions, options or tests for cases that cannot happen.

### Rejected
Duplicates of global CLAUDE.md (dropped):
- Simplicity first / minimum code / no speculative features (global YAGNI).
- Surgical changes, no "while I'm here" refactors (YAGNI "extras"; karpathy's "mention dead code, don't delete" adds ~nothing).
- Never commit before user tests (global + SKILL step 8).
- Search the web for third-party bugs (global).

Already in SKILL.md: define success criteria and verify (step 4 plan, verify step); fresh-reviewer review (step 6 note); read plan/notes first (step 4); per-step checklist (step 4).

Dropped on merit:
- Superpowers TDD iron law ("delete code written before the test"): too rigid for this repo (UI, config, docs tasks); kept only the bug-repro test.
- "Use the model only for judgment" and hard token budgets (youmind 5, 6): design/cost topics, not implementation; user says no cost framing.
- Checkpoint summaries after each step (youmind 10): the TaskUpdate checklist already does this.
- ALL CAPS / IMPORTANT emphasis, "think harder", "loop until done": docs list these as outdated and over-applied.
- Describing architecture in CLAUDE.md: out of scope for this skill.
- Subagent-for-better-answers: docs say it doesn't help.
- Superpowers "never pause between tasks": conflicts with SKILL's lgtm gate.

---

# Part: replay

## Replay candidates for task #686 (source: tasks.db, read-only)

Note: the DB spans projects; most notes-after-refinement evidence is in squash-scoreboard-display-esp32 and simple-task-manager.

### Refine
Replay: run the new refine skill on the ORIGINAL description (before notes), compare with what the notes later had to add.

1. **#569** (simple-task-manager) Add multi-repo project support: repo registry, per-task repo, cross-repo workflow.
   - Gist: DB repo registry (folder, role, build/test cmds) + contracts per project, plus `repo` and `touches[]` on tasks and repo context in getById. Goal locked 2026-11-12; "one task", registry = single source of truth, UI repo filter keeps null-repo tasks visible.
   - Notes (2026-11-15, after a coordinator run): "UI repo filter is per task... an epic is kept or dropped by its own repo, not its children's. Open question for the user." Then user override: "(1) repo filter keeps an epic visible when any of its children matches; (2) tm:implement repo mismatch is a warning for the agent only... no stop; (3) UI: 'Edit project' is merged into the /<project>/settings page."
   - Missed: epic/child semantics of the filter, mismatch behaviour in implement, and where the settings UI lives. These were all spec-level product decisions left implicit; the "one task" sizing was also large (8 KB description).

2. **#623** (squash-scoreboard) Unify Display and tournament mode: one tournament per board, tablet joins and extends it.
   - Gist: any board game mode is a tournament (roster max 16); tablet joins any time, other boards join from MENU and copy players+games. One b2b-ready BLE protocol in PROTO v2.
   - Notes: 2026-11-16 "spec review answers" (7 answers: board game lost on reboot accepted, fob leave re-join accepted, ADD_OFFLINE_GAME needs no tid, CHANGES must not echo to writer...). M2: "Spec fix: sync_tombstone/remove rev 0 -> 0x5A00". M3 "Open spec questions: (2) roster conflict (same uid, different name) unspecified; (3) unprintable names sanitized to '?' grow the roster once." 11-17 "Spec gaps done": connection bound to (tid, log_epoch), stale ACK -> INVALID, re-join never reuses log_epoch. ACK_CHANGES carried no log_epoch.
   - Missed: failure/edge semantics of a sync protocol (stale ACK, roster conflicts, reboot loss, echo). Classic "missed depth": spec covered the happy path and the model, not convergence under races.

3. **#660** (windows) Add 'Move to this screen' to taskbar long-press for the tablet display.
   - Gist: single portable C# exe (in-box csc.exe) with a touch-sized item beside the jump list on taskbar long-press, then moves the window to the pressed screen. UI Automation watcher, no hooks/injection; never guesses.
   - Notes (spike 2026-11-22): "Managed System.Windows.Automation sees MSTaskListWClass but 0 children. MSAA ... lists every button"; "Taskbar here is ExplorerPatcher's classic... Stock Win11 XAML taskbar is NOT what runs here"; the jump list is one reused CoreWindow whose title is STALE at the foreground event; prior-art note: competing app is ~150 MB WPF (unacceptable), covers sysmenu not the jump list; "Precondition: the pen must be mapped to the tablet display (see #662)".
   - Missed: the spec's "UI Automation" mechanism was wrong (MSAA/WinEvent needed); hidden precondition split into #662; taskbar variant assumption.

4. **#673** (squash-scoreboard, bug) Investigate and fix a board stuck in SYNCING; roster conflict never converges.
   - Gist: goal locked 2026-11-24, merged with former #675; investigate one incident on both firmware and app side.
   - Note M2: "A is not a board bug. Boards 2B11 / 3C22 / 7C40 and tid 7e570003 are the debug build's simulated fleet... The Lenovo log ran on Simulated transport until 13:48". Half of the investigation premise was a false lead (log came from the simulator); fix reduced to B only.
   - Also see #656 (note: Penpot approval changed two button styles after code lane landed), #496 (Store 1.0.0 waited on #498 after user decision; "v0 frozen" spec wording had to move to a new protocol version).
   Good bonus/contrast: #358 epic notes show repeated order/scope re-plans (inserted #365, #368, #376).

### Coordinator
1. **Epic #553 Android tablet client** (squash-scoreboard) children **#554** (style ref) and **#549** (MVP, 7 notes). Evidence of coordinator run: #549 note "Coordinator decisions in step 3": Transport.connect() redesigned vs plan; "Open lows" lists (PairAgain does not forget key; SecurityException retried as plain failure); "Final OCR review (two sonnet reviewers) found nothing critical or high; Medium fixed in 22873ce" (7 fixes); "Observed, not fixed: row/column order differed between runs"; "Soak run skipped by user decision"; real-phone test needed the user's go-ahead. Epic note lists commits per step. Good for unverified-result checks (soak skipped, order bug later called by-design).
2. **Epic #470 Debloat simple-task-manager** children #372 (audit), #471-#474, #476, #477 (#475 dropped). All done 2026-10-31 13:42 to 15:13 (one sitting), epic notes are "#NN done, commit sha" plus measured byte deltas. Blocker/rescue evidence: #471 note "npx tsx server.ts from source fails (mcp/uiChild.ts resolves ../../task-manager-ui)" later fixed by #478; #476 "user-approved after checklist review... 332 rules mapped"; follow-up ae3be2a "refine now states the real summary gate". Note: these edit the skills themselves (refine, coordinator), so replay on the pre-trim state (before 273d0cc) is a meaningful old-vs-new comparison.
   Also available: **#569** itself ("coordinator run 2026-11-15, uncommitted pending user test") and epic **#539** (children #533-#536, 4 done in 30 min, "Final review fixes" note after user test; user rule change overrode a locked default).

### Implement
**#560** (simple-task-manager, feature) Bump updated_at only when an edit actually changes the task. No notes, 2.9 KB description, goal locked 2026-11-10, facts verified on a scratch DB: update(), setStatus(), updateNote() must skip the bump when nothing differs; only the edited task bumps; mirror refs/delete cascades/epic membership stay non-bumping. Small store.ts change plus tests; clear acceptance. Alternatives with no notes: #616 (next-step suggestions inside bound project, 2 KB), #548 (card view on status change, 3.4 KB).

### Chosen ids
Refine: #569, #623, #660, #673. Coordinator: #553 (children #549, #554) and #470 (children #471-#477). Implement: #560.

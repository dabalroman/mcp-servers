# Evidence and research (implement-as-coordinator)

Read at Step 1.6 (evidence lines) and Step 7 (stuck → research). SKILL.md holds the rules; this file holds the menus.

## Evidence menu (Step 1.6, checked in Step 3.3)

Pick the line that proves the task works the way a user would see it. Tests and typechecks are prerequisites, not evidence.

| Task kind | Evidence | Hand-back carries |
|---|---|---|
| Web UI | Headless browser (Playwright MCP, or the host's Playwright per CLAUDE.md/memory) against the dev server: screenshots at desktop and ~390px width, one DOM assertion (element present, text, count), console free of new errors. Drive the changed flow (click, type, submit), not only the landing page. | Screenshot paths, the script path, the assertion output |
| HTTP API | A real request against the running server: status, body excerpt, and the error path (bad input → expected 4xx). | Command + response excerpt |
| CLI / script | A real run on a fixture, including one bad input; exit code and the output lines that matter. | Command + output excerpt + exit code |
| Data / migration | Run it on a copy of real-shaped data; row counts or checksums before/after; a second run is a no-op. | Commands + counts |
| Device / firmware | Build only (you own it); the device check is a breakpoint unless the project's CLAUDE.md gives a deploy/poll protocol. | What to look at on the device |
| Docs / skill text | A replay or dry-run against a past task, if the task asks for one; otherwise the diff read is the evidence. | Replay output |

- Artifacts go to `/tmp/<task-id>/`; reports name paths. Open the screenshots yourself: an image you didn't look at is a self-report.
- A UI change in a parallel run: only the lane named in the briefs runs the dev server and browser; you gather the other lane's evidence in Step 3.
- Can't gather it (no browser, no server, no fixture): say what you tried and make it a breakpoint naming exactly what the user checks.

## Research recipe (Step 7, "stuck means research")

Trigger: an agent reports BLOCKED, a check fails twice for a reason nobody can name, or the same fix has failed 3 times (stop and question the approach, don't try a 4th).

1. Write the symptom down once: exact error text, command, file, what changed last.
2. Launch 2–3 read-only agents in parallel (`run_in_background`, cheaper model), one angle each, never two on the same angle:
   - **Web:** search the exact error/symptom for the third-party tool or library and version; return the fix with its source URL.
   - **Repo:** how this repo, its git history (`git log -S`), or a sibling repo already solves or hit this; return file:line.
   - **Tools:** whether an installed skill, MCP tool (`ToolSearch`), or host tool from the inventory covers it (e.g. a browser to see what a test can't).
   - Optionally **hypothesis** agents, one competing cause each, rating their evidence direct > correlational > testimonial.
3. Each returns: conclusion, evidence, confidence, in under ~200 words. No edits.
4. Rule on it yourself, then `SendMessage` the ruling to the stuck agent (it keeps its context), or stop it and re-dispatch with what must change: more context, a stronger model, a split task, or a corrected plan.
5. Record what was tried and what worked in the final report (and on the task with `addNote` if the next attempt needs it).

## Sources

- Anthropic, "Effective harnesses for long-running agents" — Claude showed "a tendency to mark a feature as complete without proper testing"; once "explicitly prompted to use browser automation tools and do all testing as a human user would", performance "dramatically improved". https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Claude Code best practices — "ask Claude for *evidence*: the command it ran and its output, or the screenshot". https://code.claude.com/docs/en/best-practices
- Anthropic, "How we built our multi-agent research system" — "examine all available tools first, match tool usage to user intent"; "Each subagent needs an objective, an output format, guidance on the tools and sources to use, and clear task boundaries"; the lead "spins up 3-5 subagents in parallel"; "most coding tasks involve fewer truly parallelizable tasks than research"; multi-agent runs use "about 15× more tokens than chats". https://www.anthropic.com/engineering/multi-agent-research-system
- obra/superpowers (MIT), `handling-reports.md` — "**Never** ignore an escalation or force the same model to retry without changes. If the implementer said it's stuck, something needs to change"; `systematic-debugging` — "If ≥ 3 [fixes failed]: STOP and question the architecture"; subagent-driven development — "Hand artifacts over as files". https://github.com/obra/superpowers
- wshobson/agents (MIT), `parallel-debugging` — competing hypotheses, one agent each, evidence ranked direct > correlational > testimonial. https://github.com/wshobson/agents

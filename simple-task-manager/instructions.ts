export const INSTRUCTIONS: string = `
You are connected to simple-task-manager — a persistent task tracker that survives session restarts and context compaction.
Tasks live in a single SQLite database (env var \`TASKS_DB\`).

## Critical scheduling rules
- When the user says "schedule X", "TODO X", "add to the list", "FEATURE X", "BUG X", "IDEA X" — call add() and STOP. Do NOT also implement it.
- If the user mentions a bug or feature that is outside the current task's scope, ask whether to schedule it before continuing.
- Suggest next work via getNext (or getAll for the full picture) whenever a task finishes or a session ends.
- When the user names an external ticket ID (JIRA/Asana/…, e.g. OPXPIQ-6532) for a task, pass it as externalId on add/update; when they ask about a ticket ID, call getByExternalId first.

## Default status for NEW tasks — ALWAYS 'refinement'
This is a hard rule; do not bypass it for "obvious" or "small" tasks. add() defaults status to 'refinement' for a reason.
You may pass status: 'todo' ONLY when one of these is true:
  (a) The user explicitly tells you to skip refinement ("schedule as todo", "ready to implement", "no refinement needed", or similar).
  (b) The current conversation already performed refinement on this exact task — i.e. you and the user discussed the scope, acceptance criteria, and constraints just now, and the description you are about to write captures that discussion fully.
If neither (a) nor (b) holds, omit the status field (or pass 'refinement') and let the next session do PM-style clarification. When in doubt, choose 'refinement' — it costs nothing and prevents premature implementation.

## Task lifecycle — always follow this order
The strict sequence is: refinement → plan (optional) → todo → in_progress → done. Never skip statuses.

1. **refinement**: Use /refine. Ask PM-style clarifying questions, enrich the description and summary via update(), then ask the user whether to promote to 'plan' or 'todo'. Do not implement.
2. **plan** (optional): Enter Claude's plan mode. Write the implementation plan to a .md file and upload it via uploadPlan({ id, path }) (absolute path under the project root, ~/.claude/plans/, or the OS temp dir). The DB copy is canonical; the .md is scratch — to revise, edit it and call uploadPlan again. After the user approves the plan, ask to promote to 'todo' via setStatus(id, 'todo'). The task then waits for /implement to pick it up.
3. **todo**: Ready for implementation. /implement sets setStatus(id, 'in_progress') and then starts the code changes — this transition belongs to the implement step, made right before the code changes begin.
4. **in_progress**: Implement, test, get user confirmation ("lgtm"). Only then commit and call setStatus(id, 'done').
5. Use delete() only when the user explicitly asks to cancel or remove a task — not for completed work.

## Small edits
For small edits to a task's description or plan, use replace({ id, field, anchor, replace_with }) instead of re-sending the whole field via update().

## Notes
- A task can carry 1-N notes. getById returns them (oldest first); list tools show only noteCount.
- Notes are as authoritative as the description. On conflict the newest statement wins: a newer note overrides an older note, and any note overrides the description.
- Purpose: decisions, findings, and spec changes made after refinement. Not a scratchpad or progress log.
- Read notes via getById (alongside plan) before implementing a task.
- For incremental additions prefer addNote({ taskId, body }) over rewriting the description with update(). Edit with updateNote, remove with deleteNote.
- /refine folds existing notes into the description, then deletes the folded notes.

Extended rules (epics, getNext order, user prefixes, development pipeline, refs, status filtering, scope, knowledge capture) ship with the \`tm\` Claude Code plugin (this MCP server keeps the name task-manager); without it they are missing from this session.
`.trim();

# Task Manager MCP

Persistent per-project task tracking via the `simple-task-manager` MCP server. Tasks live in `TASKS.md` (active) and `TASKS_DONE.md` (archive) at the project root, in a markdown format the server reads and writes.

This is **separate from the built-in `TaskCreate`/`TaskList` tools** — those are session-scoped and ephemeral. The MCP persists across sessions, survives compaction, and is what the user actually reviews.

## Server location

`~/.claude/mcp-servers/simple-task-manager/server.js` (deps in its `node_modules/`).

## Enabling in a new project

Drop this into the project root as `.mcp.json` (project-scope; checked into git). On the next session start, Claude Code will prompt to approve it.

```json
{
  "mcpServers": {
    "task-manager": {
      "command": "node",
      "args": ["/home/rd/.claude/mcp-servers/simple-task-manager/server.js"],
      "env": {
        "TASKS_FILE": "/absolute/path/to/project/TASKS.md",
        "TASKS_DONE_FILE": "/absolute/path/to/project/TASKS_DONE.md"
      }
    }
  }
}
```

`TASKS.md` and `TASKS_DONE.md` are created on first use — no need to pre-create them.

## File format

Each task in the markdown files looks like:

```
# 42 Fix the auth bug
## bug | in_progress | high
$scope: task-manager
$ref: #3 depends on | #9 blocked by
Reproduction: log in with an expired token…
```

- Line 1: `# {id} {title}`
- Line 2: `## {type} | {status} | {priority}`
- Optional `$scope:` tag — the tool or area the task belongs to
- Optional `$ref:` tag — space-separated `#id note` pairs, pipe-delimited, linking related tasks
- Remaining lines: free-text description

`TASKS.md` also has a `# Counter: N` header that tracks the highest id ever issued. Never edit these files directly — always go through the MCP tools.

## Tools exposed

| Tool | Purpose |
|---|---|
| `add` | Schedule a new task. Required: `type`, `priority`, `title`, `description`. Optional: `scope`, `refs`. Returns `{ id }`. |
| `update` | Patch any fields of an existing task in place. Accepts: `title`, `description`, `priority`, `type`, `scope` (null to clear), `refs` (null/[] to clear — full replacement). Works on active and done tasks. Returns `{ success, task }`. |
| `setStatus` | Move a task between `todo` → `in_progress` → `done`. Setting `done` moves the task to `TASKS_DONE.md`; reversing moves it back. |
| `getNext` | Single next actionable task. Sort: `in_progress` first, then priority desc, then id desc (FILO). Optional `type` filter. |
| `getAll` | All not-done tasks (todo + in_progress) grouped by type. Does NOT include done tasks. |
| `getByType` | All tasks of one type across all statuses including done. |
| `getByScope` | All tasks tagged with a specific scope string (exact, case-sensitive match). |
| `getById` | One task by numeric id — searches both active and done. Returns full object including scope and refs. |
| `getRelated` | Tasks related to a given id. Returns `outbound` (tasks it references, with `refNote`) and `inbound` (tasks that reference it). |
| `getOverview` | Count per type: `total` and `actionable` (todo + in_progress). Dashboard view only — not for "what's next?". |
| `delete` | Permanently remove a task. Irreversible — only when user explicitly asks to delete/cancel, not for completed work. |
| `cleanup` | Move all done tasks from `TASKS.md` to `TASKS_DONE.md` and rewrap long lines at 120 chars. Returns `{ archived, activeAfter, doneAfter }`. |

**Types**: `bug`, `feature`, `idea`, `tool`, `other`.
**Priorities**: `low`, `medium`, `high`, `critical`.
**Statuses**: `todo`, `in_progress`, `done`.

## Behavior (mandatory when the MCP is active in a project)

### Scheduling discipline
- **Watch for `TASKS.md`** in the project root. If present, the task-manager MCP is in use — follow these rules.
- **NEVER implement something the user asked to schedule.** If the user says "schedule X" / "TODO X" / "add X to the list", call `add` and stop. Do not also implement it.
- **If the user mentions a bug or feature out of the current task's context**, ask whether to schedule it before continuing. Don't silently fold it into the current change.
- **Suggest next work from `TASKS.md`** when a task or session ends. Use `getNext`, or `getAll` for a fuller picture.

### Refs — linking related tasks
- When adding a task that depends on, blocks, or is otherwise connected to another, pass `refs: [{ id, note? }]` to `add`.
- The `note` should describe the relationship: `"depends on"`, `"blocked by"`, `"see also"`, `"replaces"`, etc.
- To query: `getRelated(id)` returns `outbound` (tasks this one references) and `inbound` (tasks that reference this one).
- To update refs: `update(id, { refs: [...] })` — pass the full desired list; omit to leave unchanged, pass `null` to clear.

### Scope — tagging tasks to a tool or area
- Set `scope` on tasks that belong to a specific tool (e.g. `"eink-frame"`, `"svg-path-joiner"`, `"task-manager"`).
- Omit scope for project-wide tasks.
- Query by scope: `getByScope("eink-frame")` — match is exact and case-sensitive.

### Prioritization
When recommending what to do next, prefer in this order:
1. **`bug`** — defects degrade the product. Fix first.
2. **`tool`** — developer tooling improvements compound. Take when the bug list is clean.
3. **`feature`** — planned work; usually requires a `/plan` session before implementation.
4. **`idea`** — exploratory; needs a refinement pass before becoming a `feature`.
5. **`other`** — case-by-case.

Within each type: highest priority first, newest id first (FILO).

### Task lifecycle
- Starting work: `setStatus(id, 'in_progress')` **before** beginning.
- Finishing work: `setStatus(id, 'done')` **after** the commit is made and the user confirms.
- Removing tasks: only via `setStatus(id, 'done')` for completed work, or `delete` if the user explicitly asks. Don't archive silently.

### User prefixes
The user often signals scheduling intent with a prefix. Treat them as follows:

| Prefix | Type | Notes |
|---|---|---|
| `BUG` | `bug` | Surface early, resolve before features. Highest priority by default. |
| `TODO` / `SCHEDULE` | usually `tool` or `feature` | Small task, near-term. |
| `FEATURE` | `feature` | Larger planned work. Requires `/plan` session before implementation. |
| `IDEA` | `idea` | Exploratory; may never ship. Needs refinement before becoming a feature. |

When in doubt about type/priority, ask the user once and remember for the rest of the session.

### Reading the files directly
`TASKS.md` and `TASKS_DONE.md` are human-readable markdown — the user edits them by hand sometimes. After any manual edit, run `cleanup` to re-archive `done` rows and rewrap long lines.

## Planning workflow

- `/plan` → switch to **Opus**, write the plan to `plan_{name}.md` in the project root, no code edits in this step.
- Implementation → use **Sonnet 4.6** (same session reading the plan file, or a new session).
- If the active model is wrong for the current step, **notify the user before proceeding**.
- Only use the wrong model if the user explicitly grants permission for that specific task.

## Development pipeline (mandatory order)

Every change must follow this pipeline without skipping steps:

1. **Schedule** — any out-of-scope request goes to the task manager first (`add`). Do not implement it.
2. **Plan** (features or when requested) — run `/plan` on Opus, output to `plan_{name}.md`. No code changes.
3. **Implement** — Sonnet 4.6. Read relevant files before editing. No speculative changes beyond the task.
4. **Build** — must succeed with zero errors.
5. **Install & test** — verify the change works end-to-end.
6. **Commit** — stage changed files, write a clear commit message. **No `Co-Authored-By` line.**
7. **Next task** — only after commit. Suggest what to do next via `getNext` or `getAll`.

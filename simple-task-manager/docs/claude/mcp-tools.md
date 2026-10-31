# MCP tools and handlers

Read before adding or changing a tool, a handler, or a list output.

## Layout

- `server.ts` is bootstrap only (env validation, store, `McpServer`, `registerTools`, shutdown, stdio transport, UI child spawn — see `run-modes-and-server-setup.md`).
- `instructions.ts` is the `INSTRUCTIONS` string sent on connect; its prose lands in the agent's system prompt (cap and channel rules in `CLAUDE.md`).
- `mcp/registerTools.ts` holds every tool name, description and zod schema. A new tool = a handler in `mcp/{query,mutation}Handlers.ts` + a `server.tool(...)` block in `registerTools.ts` + tests against the imported handler in `server.test.ts`. All handlers are async, for uniformity with the mutation handlers.
- `mcp/uiChild.ts` holds the UI child-process state and is eagerly imported by both `server.ts` and `mcp/mutationHandlers.ts`, to break the circular dependency that a dynamic import of `server.ts` would create.
- `mcp/http.ts` — see `mcp-over-http.md`.

## Handler behaviour that isn't obvious

- `handleUpdate` echoes the task without `plan` and with `noteCount` instead of note bodies (use `getById` for both).
- `handleReplace` counts overlapping matches by stepping 1 char and splices with `slice`, not `String.replace`, so `$&` in `replace_with` stays literal. A replace that empties the plan clears it to `null` because `store.update` trims.
- Unknown note ids return `Note #N not found.` without listing ids.
- `handleSetStatus` emits `knowledgeReminder` on `done`.

## Summary field

The token saving lives entirely in the MCP layer, not in `tasks.ts` (which always returns complete tasks):

- `toListTask` (`mcp/shared.ts`) **always drops `plan` and `notes`** (lists carry `noteCount`) and drops `description` when `summary` is present. Every list result goes through it, including `getRelated`'s anchor; only `getById` returns all fields. **A new list tool must `.map(toListTask)` its results.**
- `handleSetStatus` blocks `refinement → todo` when the task has no summary; `handleUpdate` on a summary-less refinement task returns a `summaryReminder`. The refine skill writes the summary (its step 3b) before promoting.

## Update check

`updateCheck.ts` compares the local `VERSION` with `version.ts` on this repo's `main` (raw GitHub URL, 5 s timeout), cached in memory for 1 h with concurrent callers sharing one in-flight fetch. Failures of any kind are cached as `state: 'unknown'`, never thrown. Consumers: `health`'s Version section, one `server.ts` startup log line when an update is available, and the UI's `/api/config`. Tests use the optional `fetchImpl`/`now` deps and `resetUpdateCheckCache()`.

---
name: init
description: Bind the current repo to the task-manager MCP — stdio (.mcp.json) on the package host, or client mode (HTTP + API key) against a central server. No args.
---

# Init

Bind the current repo to the task manager. A repo uses it once it has a `task-manager` MCP entry: in `.mcp.json` for stdio (the entry's `PROJECT_NAME` binds the project), or at local scope for client mode (the API key carries the default project).

## Workflow

1. **Already bound?** Check the repo's `.mcp.json` and `claude mcp get task-manager`. If an entry exists, report its mode and project (call `mcp__task-manager__health` if the tools are loaded) and stop unless the user wants to rebind.
2. **Pick the mode.** Ask the user unless it is obvious:
   - **stdio** — the repo lives on the host that holds the package; the repo gets its own DB, or shares one through `TASKS_DB`.
   - **client mode** — a central server over HTTP serves this repo (another machine, or one shared DB for every repo).
3. **stdio**: run `npx tsx <package dir>/install.ts` in the repo. `<package dir>` is the folder above the `dist/server.js` named in an already-bound repo's `.mcp.json`, or wherever the user cloned the package; ask if unknown. The script prints what it wrote; relay it.
4. **client mode**: the user creates a key for the repo in the task-manager UI (**Connect a machine**, in the footer), which gives a `claude mcp add --transport http … --scope local` line. Ask them to paste it, or run it themselves, in the repo. Never use `--scope project` or write the key into `.mcp.json`: that file is committed.
5. **Finish.** The new MCP entry and this plugin's extended rules load only in a new session: tell the user to restart Claude in the repo, then run `health` to confirm the binding and project.

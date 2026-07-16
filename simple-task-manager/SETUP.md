# simple-task-manager — Setup

<!-- `install.ts --global` @-imports this file into ~/.claude/CLAUDE.md, so it loads in EVERY
     session of EVERY project on the machine. Keep it to what an agent needs in order to set the
     MCP up somewhere new. Anything about developing this package belongs in CLAUDE.md, which
     loads on its own when working in this repo. -->

When the user asks to "set up the task manager", "install the task manager MCP", or similar:

1. Run this command in the current project directory:
   ```
   npx tsx ~/.claude/mcp-servers/simple-task-manager/install.ts
   ```
   If an existing `.mcp.json` points at the old `server.js` path, the installer rewrites it to `dist/server.js` automatically.
2. Tell the user to restart Claude Code to activate the MCP.

Do not ask for confirmation — just run it.

Once the MCP is connected it surfaces its own usage rules — task lifecycle, refinement-by-default —
on connect. They are not repeated here.

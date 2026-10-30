# simple-task-manager MCP

A persistent task manager for [Claude Code](https://claude.ai/code), exposed as an
[MCP](https://modelcontextprotocol.io) server. Tasks live in one SQLite database, so they survive
session restarts and context compaction. Claude files work as you mention it, refines it with you,
implements it, and suggests what to do next.

- **Rules built in** — the server and the `task-manager` plugin teach Claude how to use it.
- **Skills** — `/refine`, `/implement`, `/implement-as-coordinator` and `/assess`.
- **Web UI** — browse and edit the same tasks at <http://localhost:7374>, with live updates.
- **One DB or many** — one per repo by default, or one shared server for every repo and machine.

> [!warning]
> Tested on Linux and WSL2 with the Claude Code CLI. Windows is supported as a client only.

## Quick start

You need **Claude Code**, and **Node.js 18+** on any machine that runs the server.

**1. Install the plugin** (once per machine). It brings the skills and the full usage rules.

```
/plugin marketplace add dabalroman/mcp-servers
/plugin install tm@dabalroman
```

Auto-update is off for third-party marketplaces: enable it under `/plugin` → Marketplaces, or
update by hand with `claude plugin marketplace update dabalroman`,
`claude plugin update tm@dabalroman` and `/reload-plugins`. The plugin
follows GitHub `main`, so pull on the server machine too, or skills may call tools it lacks. `health`
warns when the plugin and server versions differ.

**2. Bind a repo.** Clone the package once, anywhere, then run the installer from each repo:

```sh
git clone https://github.com/dabalroman/mcp-servers <dir>
cd <dir>/simple-task-manager && npm install
cd <your repo> && npx tsx <dir>/simple-task-manager/install.ts
```

This writes a `task-manager` entry into the repo's `.mcp.json`. To share one database across repos
or machines instead, see [Client mode](#client-mode-one-server-many-repos).

**3. Restart Claude Code**, approve the `task-manager` server, and ask it to run the `health` tool.
Then just talk:

- `"BUG, high priority: unsaved text is lost when the window closes"`
- `"What should I work on next?"`
- `"/implement #15"`

Upgrading an existing clone? Follow [UPGRADING.md](UPGRADING.md).

## How it works

Every task moves through `refinement` → `plan` (optional) → `todo` → `in_progress` → `done`.

- **Schedule.** `"TODO …"`, `"BUG …"`, `"FEATURE …"` or `"IDEA …"` files a task and stops.
  Claude never implements it on the spot. New tasks start in `refinement`.
- **Refine.** Claude asks product and technical questions until the task is clear, then promotes it.
- **Implement.** Claude sets the task `in_progress`, builds and tests, then waits for your OK
  before it commits and marks the task `done`.
- **Next.** `getNext` picks bugs first, then tools, features and ideas; within a type, higher
  priority and newer tasks go first.

### Skills

| Skill | What it does |
|---|---|
| `/refine` | Claude acts as PM: clarifies the goal and scope, rewrites the task, and offers to group a split under an epic. |
| `/implement` | Implements one task (or every `todo` in a scope), runs a code review, and commits after you confirm. |
| `/implement-as-coordinator` | Supervises a queue or an epic: one subagent per task, independent checks and review, then one commit per task after you approve. |
| `/assess` | Judges a scope as a product: real-usage evidence, an advocate/skeptic debate, ranked suggestions. |

If another command uses the same name, the namespaced form works too (`/tm:implement`).

### Organising tasks

- **Projects** — every task belongs to one project, so repos can share a database. A repo's
  sessions default to its project; any tool takes `project` to reach another one. Task IDs are
  global.
- **Scopes** — free-text tags for an area within a project (`"auth"`, `"api"`).
- **Epics** — an umbrella task holding the goal, order and rules for its children. Its status
  follows them.
- **Notes** — decisions made after refinement. The newest statement wins over older notes and the
  description.
- **Refs** — links like `blocks` or `depends on`. The server writes the inverse on the other task.

Claude calls the tools itself: `add`, `update`, `setStatus`, `getNext`, `getAll`, `getById`,
`addNote`, `uploadPlan`, `health`, and more. Each describes itself to Claude when it connects.

## Web UI

A small Express + React app that shows the tasks Claude sees and pushes changes live. You can add,
edit, re-prioritise, link and delete tasks, and switch projects from a tab strip; the URL
(`http://<host>:7374/<project>`) opens a project directly. The UI and `health` both say when a
newer version is published.

### Env vars

`install.ts` writes these into `.mcp.json` and prints what each one does.

| Variable | Default | Effect |
|---|---|---|
| `TASKS_DB` | `<repo>/tasks.db` | Path to the SQLite database, shared with the UI. |
| `PROJECT_NAME` | repo dir name | The project this repo's sessions work in; unset means `default`. |
| `TASK_UI_PORT` | `7374` | Port the UI binds to. |
| `TASK_UI_AUTO_OPEN_IN_BROWSER` | `0` | `1` opens the UI in your browser on startup. |

## Client mode: one server, many repos

| Mode | What runs |
|---|---|
| **bundled** (default) | Each repo's MCP owns its DB and starts its own UI, which stops with the session. |
| **client** | One long-running **server** holds the DB and serves the UI and the MCP at `/mcp`. Repos connect over HTTP with a key and run nothing of their own. |

**On the server machine, once.** From the directory that should own the server (and, by default,
its `tasks.db`):

```sh
npx tsx <dir>/simple-task-manager/install.ts --server on [dir] [--db <path>] [--port <n>]
```

This starts the pm2 app `task-manager` on port 7374 and keeps it running across sessions and
reboots (with `pm2 startup` configured). Re-run it to change the DB or port; `--server off` stops it.

**To reach it from other machines,** put an HTTPS proxy in front that exposes **`/mcp` only**: the
UI has no login, and anyone who can open it can create keys. With [Tailscale](https://tailscale.com),
pick a free port (`tailscale serve status`) and run:

```sh
sudo tailscale serve --bg --https=<port> --set-path=/mcp http://127.0.0.1:7374/mcp
```

Other machines then use `https://<tailnet-host>:<port>/mcp`. `curl -i` on that URL should answer
`401`. Plain `http://<host>:7374/mcp` on the LAN works too, but sends the key in cleartext.

**For each repo** (on any machine, the server's included). A machine that only connects needs Claude
Code and the plugin; no clone or Node.

1. In the UI, click **Connect a machine** (footer). Enter a label, the repo's default project and the
   server URL as that machine will reach it, then **Create key**.
2. Run the line it shows, once, in the repo. It works as-is in bash and PowerShell:

   ```sh
   claude mcp add --transport http task-manager '<url>' --header 'Authorization: Bearer <key>' --scope local
   ```

   Local scope keeps the key in `~/.claude.json`, never in the committed `.mcp.json`. If the repo
   already has an entry, run `claude mcp remove task-manager -s local` first.
3. Restart Claude Code and run `health`: it should report `Transport = http` and your project.

The dialog also lists keys with their last use, and **Revoke** cuts a repo off on its next request.
Only a hash of each key is stored, so a lost key is replaced, not recovered.

## Troubleshooting

- **Claude doesn't see the tools** — approve the server when prompted, then restart the session.
- **The UI doesn't open** — reconnect with `/mcp` and read the MCP's stderr. `not found` or
  `failed to spawn` means a missing build: run `npm install` in the package. A port clash means
  setting `TASK_UI_PORT` to a free port. `TASK_UI_MODE=… is no longer supported` prints its own fix.
- **Client mode shows `failed` in `/mcp`** — `curl -i <url>`: no answer or a TLS error means the
  proxy is unreachable; `404` means the proxy path is wrong; `502`/`503` means the server is down
  (`pm2 status`). `401` is expected without a key; if sessions still fail, the key is wrong or
  revoked, so create a new one.

## Development

TypeScript, strict mode. Sources sit at the package root and build to `dist/`.

```sh
npm install      # builds dist/ and installs the pre-commit hook
npm run verify   # typecheck + test + build
```

To try plugin changes without installing, run `claude --plugin-dir <dir>/simple-task-manager/plugin`.

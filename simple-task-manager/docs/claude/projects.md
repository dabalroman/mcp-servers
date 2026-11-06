# Projects

Read before touching project binding, project-aware handlers, `PROJECT_NAME`, or the UI's project tabs. Introduced by #360 (store + binding), #369 (UI selection), #370 (pm2 name and UI decoupled from `PROJECT_NAME`).

## Store

- **Identity vs name (#521):** `projects.id` is the identity — every FK (`tasks.project`, `api_keys.project`), `PROJECT_NAME`, `X-Project`, the MCP `project` argument and the UI URL use it, case-insensitively. `projects.name` is display only and never a lookup key (`hasProject`/`canonicalProject` match the id). The id never changes after creation; the one exception is `adoptDefaultProject`. Projects that existed before `split-project-id-name` have id = their old name verbatim (not slugified), so no binding moved.
- `createProject(name)` derives the id with `slugifyProjectId` (ł→l, NFKD minus marks, lowercase, non-`[a-z0-9]` runs → `-`, trimmed, ≤ 64) and rejects a taken id (`id "x" is already taken by project "Y"`) — no suffixing. A name with no ASCII letters or digits is rejected, and so is a display name another project already has (case-insensitive, #518).
- `tasks.project` has **no column default**: a store bug must fail, not file into `default`.
- `projects.id`, `projects.name` and `tasks.project` are all `COLLATE NOCASE` so list filters match any spelling; writes still go through `canonicalProject`, which stores the stored id spelling (the NOCASE FK would otherwise accept and keep the caller's casing). `name` is NOCASE only so builds older than #521, still running against a migrated DB, keep matching `WHERE name = ?`.
- The `add-projects` migration files everything under the literal `default` and never reads env, because whichever process opens the DB first (UI or any MCP) runs it. `adoptDefaultProject(PROJECT_NAME)` runs on MCP startup only (never the UI, which ignores `PROJECT_NAME`, and never the HTTP MCP, which serves many projects): when `default` is the sole project it sets its id and name to `PROJECT_NAME` verbatim (it is an id, so not slugified), and the `ON UPDATE CASCADE` FKs move the tasks and API keys. Before #521 `api_keys.project` had no cascade, so a key bound to `default` made the adopt fail.
- Unknown projects are a `Validation failed` error from the store, never auto-created.
- `projects.track_prs` (#516, default 0) only decides whether agents are *told* to record PRs; the `prs` field and `task_prs` table work in every project. Set by the `updateProject` MCP tool or the UI's Edit project dialog; `projectTracksPrs` is false for an unknown name.
- Rename (#518) changes `projects.name` only, through store `updateProject(id, { name?, trackPrs? })`; the id and everything bound to it stay. A name another project has (case-insensitive) is rejected. The MCP `updateProject` tool deliberately takes `trackPrs` only: renaming is UI-only.
- Store list methods take `project` as their **first, required** parameter so an unfiltered call can't compile. `getAll(project, { status?, type?, scope? })` is the single filtered list query; the MCP `getAll` groups it by type in JS (#471).

## Binding

- `server.ts` builds `ctx = { project: PROJECT_NAME || 'default' }` and passes it to `registerTools`; HTTP builds `{ project: X-Project ?? key's default project, transport: 'http' }` per request.
- Server instructions are per session: `buildInstructions(store.projectTracksPrs(project))` at McpServer construction (`server.ts` resolves and adopts the project *before* building the server; `mcp/http.ts` per request). Clients read them once at `initialize`, so a `trackPrs` change applies from the next session. Both variants must fit the 4,096-char cap (`server.test.ts`).
- `ctx.transport === 'http'` skips `ui-start`/`ui-stop`, makes health collapse Config/Plugin into one `–` line (process.env is the UI server's, not the client's), and points the unknown-project hint at the header.
- Project-aware handlers (`getNext`, `getAll`, `getScopes`, `getOverview`, `add`) call `resolveProject(store, ctx, args.project)` in `mcp/shared.ts`, which returns the name or an `errorText`.
- Global on purpose (IDs are global): `getById`, `getRelated`, `getByExternalId` (a ticket ID is an identifier lookup), `getByPr`, `setStatus`, `delete`, notes, refs, epic links, and `load()`/`loadWithNotes()`. Reads only: new refs and epic links must stay in one project (#499).
- Only the session-binding note lives in `plugin/RULES.md` (Projects); never-invent and global ids live in the `project` param, `getProjects` and `createProject` descriptions, so plugin-less sessions get them too.

## UI

- Tabs, the switcher and the project `<select>`s in the task form and Connect dialog use the id as value and show the name; `GET/POST /api/projects` return `{ id, name, … }`.
- The UI loads everything and filters on the client (`filterByProject` in `src/lib/taskView.ts`), so `/api/tasks` and `/stream` stay project-agnostic; `GET/POST /api/projects` lists and creates projects; `PATCH /api/projects/:id` takes `{ name?, trackPrs? }`.
- Selection (#369): the URL's first path segment is the project (`projectFromPath`/`projectPath` in `taskView.ts`), plain History API, no router. URL beats localStorage on load; `selectProject` pushes, an effect `replaceState`s `/`, miscased or unknown names to the canonical path, `popstate` follows Back/Forward. Deep links work only because `server.ts` (and Vite's default `appType: 'spa'`) fall back to `index.html` and assets are absolute — keep both.
- There is no project label in the UI (#370): the project tabs show the active project. Below `sm` (#500) `ProjectSwitcher` swaps the tabs for a dropdown trigger (shown even with one project, so its `+ Project` and `Edit project` items stay reachable). `ProjectDialog` is create mode without `initial` and edit mode (name, read-only id, track-PRs checkbox) with it; desktop opens edit from the `Edit project` button next to `+ Project`.

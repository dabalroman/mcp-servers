# Projects

Read before touching project binding, project-aware handlers, `PROJECT_NAME`, or the UI's project tabs. Introduced by #360 (store + binding), #369 (UI selection), #370 (pm2 name and UI decoupled from `PROJECT_NAME`).

## Store

- `tasks.project` has **no column default**: a store bug must fail, not file into `default`.
- `projects.name` and `tasks.project` are both `COLLATE NOCASE` so list filters match any spelling; writes still go through `canonicalProject`, which stores the projects-table spelling (the NOCASE FK would otherwise accept and keep the caller's casing).
- The `add-projects` migration files everything under the literal `default` and never reads env, because whichever process opens the DB first (UI or any MCP) runs it. `adoptDefaultProject(PROJECT_NAME)` runs on MCP startup only (never the UI, which ignores `PROJECT_NAME`, and never the HTTP MCP, which serves many projects): when `default` is the sole project it renames it, and the `ON UPDATE CASCADE` FK moves the tasks.
- Unknown projects are a `Validation failed` error from the store, never auto-created.
- Store list methods take `project` as their **first, required** parameter so an unfiltered call can't compile. `getAll(project, { status?, type?, scope? })` is the single filtered list query; the MCP `getAll` groups it by type in JS (#471).

## Binding

- `server.ts` builds `ctx = { project: PROJECT_NAME || 'default' }` and passes it to `registerTools`; HTTP builds `{ project: X-Project ?? key's default project, transport: 'http' }` per request.
- `ctx.transport === 'http'` skips `ui-start`/`ui-stop`, makes health collapse Config/Plugin into one `–` line (process.env is the UI server's, not the client's), and points the unknown-project hint at the header.
- Project-aware handlers (`getNext`, `getAll`, `getScopes`, `getOverview`, `add`) call `resolveProject(store, ctx, args.project)` in `mcp/shared.ts`, which returns the name or an `errorText`.
- Global on purpose (IDs are global): `getById`, `getRelated`, `getByExternalId` (a ticket ID is an identifier lookup), `setStatus`, `delete`, notes, refs, epic links, and `load()`/`loadWithNotes()`. Reads only: new refs and epic links must stay in one project (#499).
- Only the session-binding note lives in `plugin/RULES.md` (Projects); never-invent and global ids live in the `project` param, `getProjects` and `createProject` descriptions, so plugin-less sessions get them too.

## UI

- The UI loads everything and filters on the client (`filterByProject` in `src/lib/taskView.ts`), so `/api/tasks` and `/stream` stay project-agnostic; `GET/POST /api/projects` lists and creates projects.
- Selection (#369): the URL's first path segment is the project (`projectFromPath`/`projectPath` in `taskView.ts`), plain History API, no router. URL beats localStorage on load; `selectProject` pushes, an effect `replaceState`s `/`, miscased or unknown names to the canonical path, `popstate` follows Back/Forward. Deep links work only because `server.ts` (and Vite's default `appType: 'spa'`) fall back to `index.html` and assets are absolute — keep both.
- There is no project label in the UI (#370): the project tabs show the active project. Below `sm` (#500) `ProjectSwitcher` swaps the tabs for a dropdown trigger (shown even with one project, so its `+ Project` item stays reachable).

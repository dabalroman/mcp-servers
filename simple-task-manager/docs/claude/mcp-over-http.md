# MCP over HTTP (`/mcp`, #361)

Read before touching `mcp/http.ts`, the `/mcp` mount, or API keys.

`task-manager-ui/server.ts` mounts `/mcp` in both modes (the server's pm2 app and the bundled child), **before** the global `express.json()`: the transport reads the body itself — don't put a body parser in front of it. `createMcpHttpHandler` uses plain `node:http` types, no express, so `http.test.ts` (node:test) drives it directly.

Clients add it with the line the UI's Connect a machine dialog prints: `claude mcp add --transport http task-manager '<url>/mcp' --header 'Authorization: Bearer <key>' --scope local`. Local scope lives in the user's `~/.claude.json`, wins over a committed `.mcp.json`, and keeps the key out of the repo — never `--scope project`.

## Request order

1. API key: 401, same body for missing/wrong/revoked, `WWW-Authenticate: Bearer` with **no OAuth `resource_metadata`** — Claude Code would start OAuth.
2. POST only (405).
3. Project = `X-Project` header, else the key's default project (400 if neither).
4. A fresh `McpServer` + stateless `StreamableHTTPServerTransport` per request.

No loopback exemption and no Host check: DNS rebinding can't supply the key, and a Host list would block LAN clients.

## Deliberate choices

- **Stateless**: no session map, a `pm2 restart` strands no client, and the tools send no server→client notifications.
- **Second store connection**: `PRAGMA data_version` only moves for writes from *other* connections, so the UI's 1 s poll pushes SSE for MCP writes with no extra wiring.
- Never calls `adoptDefaultProject` — one process serves many projects.

## API keys (#362)

- Key = `stm_` + 32 random bytes base64url; only the SHA-256 is stored (a random 256-bit key needs no slow hash). `verifyApiKey` looks up by hash, `timingSafeEqual`s, skips revoked rows and returns `{ id, project }`.
- One key per repo: its `project` is the connection's default — a suggestion, not a boundary; tools still take `project`. NULL for keys from before migration `20261029120000`; those need `X-Project`.
- `last_used_at` is touched at most once a minute (spares the write lock and the UI's `data_version` poll), best-effort: a stale schema or busy DB never fails auth.
- Managed only in the UI (`/api/keys`, Connect a machine dialog in the footer). `listApiKeys` returns active keys only, rows never carry the hash, the plaintext key appears once in the POST response, nothing goes over SSE.

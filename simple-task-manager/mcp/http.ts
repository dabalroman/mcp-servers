import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { VERSION } from '../version.js';
import { INSTRUCTIONS } from '../instructions.js';
import { registerTools } from './registerTools.js';
import type { Store, VerifiedKey } from '../tasks.js';

// Plain node:http types (no express) so node:test can drive the handler.

function bearerToken(header: string | undefined): string | undefined {
  const m = header?.match(/^Bearer +(\S+) *$/i);
  return m?.[1];
}

function sendError(res: ServerResponse, status: number, code: number, message: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

export type McpHttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

// Stateless: a fresh server + transport per POST, project resolved every time, so
// there is no session map to leak and a process restart strands no client.
// The transport reads the body itself, so nothing is parsed before the guards
// and bad JSON gets a JSON-RPC parse error.
// The key is checked on every request, loopback included: a TLS reverse proxy
// (e.g. `tailscale serve`) forwards from 127.0.0.1. There is no Host check
// either: DNS rebinding can't supply the bearer key, and a loopback-only Host
// list would block LAN and proxied clients.
export function createMcpHttpHandler({ store }: { store: Store }): McpHttpHandler {
  return async (req, res) => {
    const key = bearerToken(req.headers.authorization);
    let verified: VerifiedKey | null = null;
    try {
      verified = key === undefined ? null : store.verifyApiKey(key);
    } catch (err) {
      // No detail before auth: the caller may be anyone.
      console.error('[mcp/http] key check failed:', err);
      sendError(res, 500, -32603, 'Internal error');
      return;
    }
    if (!verified) {
      // Same body for missing, wrong and revoked keys. No OAuth resource_metadata:
      // Claude Code would start an OAuth flow.
      sendError(res, 401, -32001, 'Unauthorized', { 'WWW-Authenticate': 'Bearer' });
      return;
    }
    if (req.method !== 'POST') {
      sendError(res, 405, -32000, 'Method not allowed: /mcp is stateless and accepts POST only', { Allow: 'POST' });
      return;
    }
    const raw = req.headers['x-project'];
    // The header overrides the key's default project; keys from before keys had
    // a project rely on it.
    const project = (Array.isArray(raw) ? raw[0] : raw)?.trim() || verified.project;
    if (!project) {
      sendError(res, 400, -32600, 'This API key has no default project — send an X-Project header, or create a new key in the UI (Connect a machine)');
      return;
    }

    try {
      const server = new McpServer({ name: 'simple-task-manager', version: VERSION }, { instructions: INSTRUCTIONS });
      registerTools(server, store, { project, transport: 'http' });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      if (!res.headersSent) sendError(res, 500, -32603, `Internal error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

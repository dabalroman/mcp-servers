import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { VERSION } from '../version.js';
import { INSTRUCTIONS } from '../instructions.js';
import { registerTools } from './registerTools.js';
import type { Store } from '../tasks.js';

// Plain node:http types (no express) so node:test can drive the handler.

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopback(addr?: string): boolean {
  return addr !== undefined && LOOPBACK.has(addr);
}

function sendError(res: ServerResponse, status: number, code: number, message: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

export type McpHttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

// Stateless: a fresh server + transport per POST, X-Project read every time, so
// there is no session map to leak and a process restart strands no client.
// The transport reads the body itself, so nothing is parsed before the guards
// and bad JSON gets a JSON-RPC parse error.
export function createMcpHttpHandler({ store, port }: { store: Store; port: number }): McpHttpHandler {
  const allowedHosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];

  return async (req, res) => {
    if (!isLoopback(req.socket.remoteAddress)) {
      sendError(res, 403, -32000, '/mcp accepts loopback connections only (API keys are not supported yet)');
      return;
    }
    if (req.method !== 'POST') {
      sendError(res, 405, -32000, 'Method not allowed: /mcp is stateless and accepts POST only', { Allow: 'POST' });
      return;
    }
    const raw = req.headers['x-project'];
    const project = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!project) {
      sendError(res, 400, -32600, 'Missing X-Project header — bind the connection to a project, e.g. claude mcp add --transport http task-manager <url> --header "X-Project: <project>"');
      return;
    }

    try {
      const server = new McpServer({ name: 'simple-task-manager', version: VERSION }, { instructions: INSTRUCTIONS });
      registerTools(server, store, { project, transport: 'http' });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        // Blocks DNS-rebinding pages in a local browser. Deprecated in the SDK
        // in favour of middleware, still supported.
        enableDnsRebindingProtection: true,
        allowedHosts,
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

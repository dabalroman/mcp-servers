import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createStore, type Store } from './tasks.js';
import { createMcpHttpHandler, isLoopback } from './mcp/http.js';

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

const realFetch = globalThis.fetch;
before(() => {
  // The update check in health must not reach the network; the MCP client gets realFetch explicitly.
  globalThis.fetch = (async () => { throw new Error('network disabled in tests'); }) as unknown as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});

let dir: string;
let dbPath: string;
let store: Store;
let server: Server;
let port: number;
const clients: Client[] = [];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'stm-http-test-'));
  dbPath = join(dir, 'tasks.db');
  store = createStore(dbPath);
  store.createProject('a');
  store.createProject('b');
  let handler: ReturnType<typeof createMcpHttpHandler> | undefined;
  server = createServer((req, res) => { void handler!(req, res); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  handler = createMcpHttpHandler({ store, port });
});

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => { /* ignore */ });
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function connect(project: string): Promise<Client> {
  const client = new Client({ name: 'http-test', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { 'X-Project': project } },
    fetch: realFetch,
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return await client.callTool({ name, arguments: args }) as ToolResult;
}

function raw(opts: { method: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/mcp', method: opts.method, headers: opts.headers }, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => { data += c.toString('utf-8'); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}

const INIT = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
});
const POST_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

describe('MCP over Streamable HTTP', () => {
  test('lists the tools without ui-start / ui-stop', async () => {
    const client = await connect('a');
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes('getNext'));
    assert.ok(names.includes('add'));
    assert.ok(!names.includes('ui-start'));
    assert.ok(!names.includes('ui-stop'));
  });

  test('getNext respects X-Project, and two clients on one server each see their own project', async () => {
    const a = await connect('a');
    const b = await connect('b');
    const added = await call(a, 'add', { title: 'only in a', type: 'bug', priority: 'high', status: 'todo' });
    assert.ok(!added.isError, added.content[0]?.text);

    const fromB = await call(b, 'getNext');
    assert.ok(!fromB.content[0]!.text.includes('only in a'));
    const fromA = await call(a, 'getNext');
    assert.ok(fromA.content[0]!.text.includes('only in a'));
  });

  test('missing X-Project → 400 naming the header', async () => {
    const res = await raw({ method: 'POST', headers: POST_HEADERS, body: INIT });
    assert.equal(res.status, 400);
    assert.match(res.body, /X-Project/);
  });

  test('GET → 405 with Allow: POST', async () => {
    const res = await raw({ method: 'GET', headers: { 'X-Project': 'a' } });
    assert.equal(res.status, 405);
    assert.equal(res.headers['allow'], 'POST');
  });

  test('a foreign Host header is rejected (DNS rebinding)', async () => {
    const res = await raw({ method: 'POST', headers: { ...POST_HEADERS, 'X-Project': 'a', Host: `rebind.example:${port}` }, body: INIT });
    assert.equal(res.status, 403);
    assert.match(res.body, /Invalid Host header/);
  });

  test('an allowed Host header is accepted', async () => {
    const res = await raw({ method: 'POST', headers: { ...POST_HEADERS, 'X-Project': 'a', Host: `localhost:${port}` }, body: INIT });
    assert.equal(res.status, 200);
  });

  test('malformed JSON → JSON-RPC parse error', async () => {
    const res = await raw({ method: 'POST', headers: { ...POST_HEADERS, 'X-Project': 'a' }, body: '{not json' });
    assert.equal(res.status, 400);
    assert.match(res.body, /-32700/);
  });

  test('a body over 100 kB (long description) is accepted', async () => {
    const client = await connect('a');
    const added = await call(client, 'add', { title: 'long', type: 'bug', priority: 'low', description: 'x'.repeat(300_000) });
    assert.ok(!added.isError, added.content[0]?.text);
  });

  test('health reports Transport = http and skips Config/Plugin', async () => {
    const client = await connect('a');
    const res = await call(client, 'health');
    const report = (JSON.parse(res.content[0]!.text) as { report: string }).report;
    assert.match(report, /Transport = http/);
    assert.match(report, /– skipped over HTTP/);
    assert.ok(!report.includes('plugin not installed'));
    assert.ok(!report.includes('PROJECT_NAME ='));
  });

  test('unknown X-Project → tool error naming the header', async () => {
    const client = await connect('nope');
    const res = await call(client, 'getNext');
    assert.equal(res.isError, true);
    assert.match(res.content[0]!.text, /X-Project header/);
  });

  test('withSchemaCheck applies: stale DB refuses writes and flags reads', async () => {
    const client = await connect('a');
    const other = new Database(dbPath);
    other.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(99, 'future-migration');
    other.close();

    const added = await call(client, 'add', { title: 't', type: 'bug', priority: 'low' });
    assert.equal(added.isError, true);
    const all = await call(client, 'getAll');
    assert.ok(all.content.some((c) => c.text.startsWith('⚠')));
  });
});

describe('isLoopback', () => {
  test('truth table', () => {
    for (const addr of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopback(addr), true, addr);
    for (const addr of [undefined, '', '10.0.0.2', '::ffff:10.0.0.2', '127.0.0.2', '0.0.0.0']) assert.equal(isLoopback(addr), false, String(addr));
  });
});

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStore, type Store } from './tasks.js';
import { registerTools } from './mcp/registerTools.js';
import { attachCallLog, callLogFile, callLogState, redactArgs, setCallLogDir, appendCallLog, type CallLogLine } from './mcp/callLog.js';

describe('redactArgs', () => {
  test('free text becomes its length; enums, identifiers, numbers and booleans stay', () => {
    assert.deepEqual(
      redactArgs({ type: 'bug', priority: 'high', title: 'Fix the thing', description: '', scope: 'example-scope', project: 'example', status: 'todo', parentId: 3 }),
      { type: 'bug', priority: 'high', title: '<13 chars>', description: '<0 chars>', scope: 'example-scope', project: 'example', status: 'todo', parentId: 3 },
    );
    assert.deepEqual(redactArgs({ id: 7, field: 'plan', anchor: 'abc', replace_with: 'de' }), { id: 7, field: 'plan', anchor: '<3 chars>', replace_with: '<2 chars>' });
    assert.deepEqual(redactArgs({ trackPrs: true, summary: null }), { trackPrs: true, summary: null });
  });

  test('arrays keep their element shape', () => {
    assert.deepEqual(redactArgs({ refs: [{ id: 2, relation: 'blocks' }] }), { refs: [{ id: 2, relation: 'blocks' }] });
    assert.deepEqual(redactArgs({ order: [1, [2, 3]] }), { order: [1, [2, 3]] });
    assert.deepEqual(
      redactArgs({ prs: [{ url: 'https://example.com/o/r/pull/1', number: 1, status: 'open' }] }),
      { prs: [{ url: '<30 chars>', number: 1, status: 'open' }] },
    );
  });
});

describe('call log file', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'stm-calllog-test-'));
    setCallLogDir(join(dir, 'task-logs'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('one file per UTC day', () => {
    assert.equal(callLogFile(new Date('2026-03-04T23:59:59.999Z')), join(dir, 'task-logs', '2026-03-04.jsonl'));
  });

  test('a failed write is swallowed and reported in the state', () => {
    writeFileSync(join(dir, 'not-a-dir'), '');
    setCallLogDir(join(dir, 'not-a-dir', 'task-logs'));
    const line: CallLogLine = { ts: new Date().toISOString(), session: 's', seq: 1, project: 'p', transport: 'stdio', tool: 'health', args: {}, outcome: 'ok', ms: 0 };
    const stderr = process.stderr.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      assert.doesNotThrow(() => appendCallLog(line));
    } finally {
      process.stderr.write = stderr;
    }
    assert.match(callLogState().lastWriteError ?? '', /\S/);
  });
});

describe('attachCallLog over a real MCP server', () => {
  let dir: string;
  let store: Store;
  let client: Client;
  let session: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'stm-calllog-test-'));
    setCallLogDir(join(dir, 'task-logs'));
    store = createStore(join(dir, 'tasks.db'));
    store.createProject('example');
    session = randomUUID();
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerTools(server, store, { project: 'example', transport: 'stdio' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    attachCallLog(serverSide, { store, session, project: 'example', transport: 'stdio' });
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientSide);
  });

  afterEach(async () => {
    await client.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function lines(): CallLogLine[] {
    const file = callLogFile();
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf-8').trim().split('\n').map((l) => JSON.parse(l) as CallLogLine);
  }

  test('ok, tool error and schema-rejected calls each log one line', async () => {
    await client.callTool({ name: 'add', arguments: { type: 'bug', priority: 'high', title: 'Secret title' } });
    await client.callTool({ name: 'getById', arguments: { id: 999 } });
    await client.callTool({ name: 'getById', arguments: { id: 'abc' } });
    await client.callTool({ name: 'noSuchTool', arguments: {} });

    const log = lines();
    assert.equal(log.length, 4);
    assert.deepEqual(log.map((l) => [l.seq, l.tool, l.outcome]), [
      [1, 'add', 'ok'],
      [2, 'getById', 'error'],
      [3, 'getById', 'validation_error'],
      [4, 'noSuchTool', 'validation_error'],
    ]);
    const [add, missing] = log;
    assert.equal(add?.session, session);
    assert.equal(add?.project, 'example');
    assert.equal(add?.transport, 'stdio');
    assert.deepEqual(add?.args, { type: 'bug', priority: 'high', title: '<12 chars>' });
    assert.equal(add?.error, undefined);
    assert.equal(typeof add?.ms, 'number');
    assert.match(missing?.error ?? '', /not found/);
    assert.ok(!readFileSync(callLogFile(), 'utf-8').includes('Secret title'));
  });

  test('setStatus logs the status it moved from', async () => {
    const { id } = store.add({ type: 'bug', priority: 'low', title: 'x', project: 'example' });
    await client.callTool({ name: 'setStatus', arguments: { id, status: 'todo' } });
    const [line] = lines();
    assert.equal(line?.from, 'refinement');
    assert.deepEqual(line?.args, { id, status: 'todo' });
  });

  test('non-tool requests are not logged', async () => {
    await client.listTools();
    assert.equal(lines().length, 0);
  });
});

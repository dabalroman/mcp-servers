import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ErrorCode, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { PACKAGE_DIR } from '../packageDir.js';
import type { Store } from '../tasks.js';

// Event log of every tool call (#598): one JSON line per call in a daily file
// under <package>/task-logs/, so how agents actually use the tools can be
// replayed. Hooked on the transport, not the tool callbacks: the SDK rejects
// schema-invalid args before a callback runs, and those calls are the point.

// String args kept verbatim: enum values and identifiers. Every other string
// is free text and is logged as its length only.
const VERBATIM_KEYS = new Set(['status', 'type', 'priority', 'relation', 'field', 'project', 'scope', 'repo', 'touches', 'contract', 'position']);
const ERROR_MAX = 500;
// McpError(InvalidParams) text: schema rejection or unknown tool.
const INVALID_PARAMS = `MCP error ${ErrorCode.InvalidParams}`;

let dir = resolve(PACKAGE_DIR, 'task-logs');
let dirReady = false;
let lastWriteError: string | undefined;
const seqBySession = new Map<string, number>();

/** Tests only: point the log at a temp dir and reset the write state. */
export function setCallLogDir(path: string): void {
  dir = path;
  dirReady = false;
  lastWriteError = undefined;
}

export function callLogFile(now: Date = new Date()): string {
  return join(dir, `${now.toISOString().slice(0, 10)}.jsonl`);
}

export function redactArgs(value: unknown, key?: string): unknown {
  if (typeof value === 'string') return key !== undefined && VERBATIM_KEYS.has(key) ? value : `<${value.length} chars>`;
  if (Array.isArray(value)) return value.map((v) => redactArgs(v, key));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactArgs(v, k)]));
  }
  return value;
}

export type CallLogLine = {
  ts: string;
  session: string;
  seq: number;
  project: string;
  transport: 'stdio' | 'http';
  tool: string;
  args: unknown;
  from?: string;
  outcome: 'ok' | 'validation_error' | 'error';
  error?: string;
  ms: number;
};

// One appendFileSync per line: O_APPEND + a single write keeps lines from
// concurrent processes (stdio sessions, the pm2 server) from interleaving.
// Never throws: logging must not break a call.
export function appendCallLog(line: CallLogLine): void {
  try {
    if (!dirReady) {
      mkdirSync(dir, { recursive: true });
      dirReady = true;
    }
    appendFileSync(callLogFile(new Date(line.ts)), `${JSON.stringify(line)}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (lastWriteError === undefined) process.stderr.write(`[simple-task-manager] call log write failed: ${msg}\n`);
    lastWriteError = `${new Date().toISOString()} ${msg}`;
  }
}

export function callLogState(): { file: string; lines: number; lastWriteError?: string } {
  const file = callLogFile();
  let lines = 0;
  try {
    const body = readFileSync(file, 'utf-8');
    for (let i = body.indexOf('\n'); i !== -1; i = body.indexOf('\n', i + 1)) lines++;
  } catch { /* no calls logged today */ }
  return lastWriteError === undefined ? { file, lines } : { file, lines, lastWriteError };
}

function nextSeq(session: string): number {
  const seq = (seqBySession.get(session) ?? 0) + 1;
  seqBySession.set(session, seq);
  return seq;
}

function currentStatus(store: Store, args: unknown): string | undefined {
  const id = Number((args as { id?: unknown } | undefined)?.id);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  try {
    return store.getById(id)?.status;
  } catch {
    return undefined;
  }
}

function outcomeOf(msg: JSONRPCMessage): Pick<CallLogLine, 'outcome' | 'error'> {
  if ('error' in msg) return { outcome: 'error', error: msg.error.message.slice(0, ERROR_MAX) };
  if (!('result' in msg) || msg.result.isError !== true) return { outcome: 'ok' };
  const content = msg.result.content as { type?: string; text?: string }[] | undefined;
  const text = content?.find((c) => c.type === 'text')?.text ?? '';
  return { outcome: text.includes(INVALID_PARAMS) ? 'validation_error' : 'error', error: text.slice(0, ERROR_MAX) };
}

export type CallLogMeta = { store: Store; session: string; project: string; transport: 'stdio' | 'http' };

type Pending = { ts: string; start: number; tool: string; args: unknown; from?: string };

/** Wraps a connected transport (call after server.connect) so each tools/call request and its response become one log line. */
export function attachCallLog(transport: Transport, meta: CallLogMeta): void {
  const pending = new Map<string | number, Pending>();

  const receive = transport.onmessage;
  transport.onmessage = (msg, extra) => {
    if ('method' in msg && msg.method === 'tools/call' && 'id' in msg) {
      const params = msg.params as { name?: unknown; arguments?: unknown } | undefined;
      const tool = typeof params?.name === 'string' ? params.name : '';
      const entry: Pending = { ts: new Date().toISOString(), start: performance.now(), tool, args: redactArgs(params?.arguments ?? {}) };
      if (tool === 'setStatus') entry.from = currentStatus(meta.store, params?.arguments);
      pending.set(msg.id, entry);
    }
    receive?.(msg, extra);
  };

  const send = transport.send.bind(transport);
  transport.send = async (msg, options) => {
    const id = 'id' in msg && !('method' in msg) && msg.id !== null ? msg.id : undefined;
    const call = id === undefined ? undefined : pending.get(id);
    if (call && id !== undefined) {
      pending.delete(id);
      appendCallLog({
        ts: call.ts,
        session: meta.session,
        seq: nextSeq(meta.session),
        project: meta.project,
        transport: meta.transport,
        tool: call.tool,
        args: call.args,
        ...(call.from === undefined ? {} : { from: call.from }),
        ...outcomeOf(msg),
        ms: Math.round(performance.now() - call.start),
      });
    }
    return send(msg, options);
  };
}

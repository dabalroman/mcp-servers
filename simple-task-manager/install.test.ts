/**
 * install.test.ts — smoke tests for mcpConfig helpers and the install.ts rewrite logic.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isStaleEntry, serializeMcpConfig, parseMcpConfig, type McpConfig, type McpEntry } from './mcpConfig.js';

// ── serializeMcpConfig ────────────────────────────────────────────────────────

describe('serializeMcpConfig', () => {
  test('produces valid JSON', () => {
    const config: McpConfig = {
      mcpServers: {
        'task-manager': {
          command: 'node',
          args: ['/abs/path/dist/server.js'],
          env: { TASKS_DB: '/abs/tasks.db', PROJECT_NAME: 'myproj' },
        },
      },
    };
    const out = serializeMcpConfig(config);
    assert.doesNotThrow(() => JSON.parse(out));
  });

  test('round-trips: parse → serialize → parse gives equivalent config', () => {
    const config: McpConfig = {
      mcpServers: {
        'task-manager': {
          command: 'node',
          args: ['/abs/dist/server.js'],
          env: { TASKS_DB: '/abs/tasks.db', PROJECT_NAME: 'test', TASK_UI_PORT: '7374' },
        },
      },
    };
    const serialized = serializeMcpConfig(config);
    const reparsed = parseMcpConfig(serialized);
    assert.deepEqual(reparsed, config);
  });

  test('orders env keys by ENV_ORDER (TASKS_DB before PROJECT_NAME before TASK_UI_PORT)', () => {
    const config: McpConfig = {
      mcpServers: {
        'task-manager': {
          command: 'node',
          args: [],
          env: { TASK_UI_PORT: '7374', TASKS_DB: '/abs/tasks.db', PROJECT_NAME: 'proj' },
        },
      },
    };
    const out = serializeMcpConfig(config);
    const tasksDbPos  = out.indexOf('"TASKS_DB"');
    const projectPos  = out.indexOf('"PROJECT_NAME"');
    const portPos     = out.indexOf('"TASK_UI_PORT"');
    assert.ok(tasksDbPos < projectPos, 'TASKS_DB before PROJECT_NAME');
    assert.ok(projectPos < portPos,    'PROJECT_NAME before TASK_UI_PORT');
  });

  test('handles entry with no env block', () => {
    const config: McpConfig = {
      mcpServers: { 'other-server': { command: 'node', args: ['/path/server.js'] } },
    };
    const out = serializeMcpConfig(config);
    assert.doesNotThrow(() => JSON.parse(out));
    assert.ok(!out.includes('"env"'));
  });

  test('multiple servers are all present in output', () => {
    const config: McpConfig = {
      mcpServers: {
        alpha: { command: 'node', args: ['/a'] },
        beta:  { command: 'node', args: ['/b'] },
      },
    };
    const out = serializeMcpConfig(config);
    assert.ok(out.includes('"alpha"'));
    assert.ok(out.includes('"beta"'));
  });
});

// ── isStaleEntry ──────────────────────────────────────────────────────────────

describe('isStaleEntry — rewrite path detection', () => {
  test('returns false for undefined', () => {
    assert.equal(isStaleEntry(undefined), false);
  });

  test('returns true when args[0] ends with /server.js (old root layout)', () => {
    const e: McpEntry = { command: 'node', args: ['/home/rd/.claude/mcp-servers/simple-task-manager/server.js'] };
    assert.equal(isStaleEntry(e), true);
  });

  test('returns true when args[0] ends with /server.ts (tsx direct run)', () => {
    const e: McpEntry = { command: 'node', args: ['/path/to/server.ts'] };
    assert.equal(isStaleEntry(e), true);
  });

  test('returns false for the correct dist/server.js path', () => {
    const e: McpEntry = { command: 'node', args: ['/home/rd/.claude/mcp-servers/simple-task-manager/dist/server.js'] };
    assert.equal(isStaleEntry(e), false);
  });

  test('returns false for empty args', () => {
    const e: McpEntry = { command: 'node', args: [] };
    assert.equal(isStaleEntry(e), false);
  });
});

/**
 * install.test.ts — smoke tests for mcpConfig helpers and the install.ts rewrite logic.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isStaleEntry, serializeMcpConfig, parseMcpConfig, parseInstallArgs, pm2AppName,
  type McpConfig, type McpEntry
} from './mcpConfig.js';
import { ecosystemFile } from './serverSetup.js';

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

describe('pm2AppName', () => {
  test('is task-manager on the default port, whatever the repo', () => {
    assert.equal(pm2AppName(undefined), 'task-manager');
    assert.equal(pm2AppName('7374'), 'task-manager');
  });

  test('carries the port otherwise, so two UIs on two ports never share a name', () => {
    assert.equal(pm2AppName('7380'), 'task-manager-7380');
  });
});

describe('parseInstallArgs', () => {
  test('no args → current directory', () => {
    assert.deepEqual(parseInstallArgs([]), {});
  });

  test('one positional → project dir', () => {
    assert.deepEqual(parseInstallArgs(['../repo']), { projectDir: '../repo' });
  });

  test('--global points at the plugin install', () => {
    const r = parseInstallArgs(['--global']);
    assert.ok('error' in r);
    assert.match(r.error, /claude plugin install tm@dabalroman/);
  });

  test('an unknown flag is rejected', () => {
    assert.deepEqual(parseInstallArgs(['--force']), { error: 'Unknown option --force' });
  });

  test('--server on with dir, --db and --port', () => {
    assert.deepEqual(parseInstallArgs(['--server', 'on', '../srv', '--db', '/data/tasks.db', '--port', '7380']),
      { server: 'on', projectDir: '../srv', db: '/data/tasks.db', port: '7380' });
  });

  test('--server off alone', () => {
    assert.deepEqual(parseInstallArgs(['--server', 'off']), { server: 'off' });
  });

  test('--server rejects anything but on/off, and a missing value', () => {
    assert.deepEqual(parseInstallArgs(['--server', 'maybe']), { error: '--server takes on or off, got: maybe' });
    assert.deepEqual(parseInstallArgs(['--server']), { error: '--server needs a value' });
    assert.deepEqual(parseInstallArgs(['--server', 'on', '--db']), { error: '--db needs a value' });
  });

  test('--port must be in range', () => {
    const r = parseInstallArgs(['--server', 'on', '--port', '70000']);
    assert.ok('error' in r);
    assert.match(r.error, /--port must be an integer 1-65535/);
  });

  test('--db / --port without --server are rejected', () => {
    assert.ok('error' in parseInstallArgs(['--db', 'x.db']));
    assert.ok('error' in parseInstallArgs(['--port', '7380']));
  });

  test('two positionals are rejected', () => {
    assert.ok('error' in parseInstallArgs(['a', 'b']));
  });
});

describe('ecosystemFile', () => {
  test('carries the app, db and port, and no mode key', () => {
    const out = ecosystemFile({ appName: 'task-manager', uiCwd: '/pkg/task-manager-ui', db: '/data/tasks.db', port: '7374' });
    assert.match(out, /name: "task-manager"/);
    assert.match(out, /TASKS_DB: "\/data\/tasks.db"/);
    assert.match(out, /TASK_UI_PORT: "7374"/);
    assert.doesNotMatch(out, /TASK_UI_MODE/);
  });
});

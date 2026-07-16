/**
 * install.test.ts — smoke tests for mcpConfig helpers and the install.ts rewrite logic.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isStaleEntry, serializeMcpConfig, parseMcpConfig, updateGlobalImport,
  type McpConfig, type McpEntry
} from './mcpConfig.js';

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

// ── updateGlobalImport ────────────────────────────────────────────────────────

const SETUP = '/abs/path/mcp-servers/simple-task-manager/SETUP.md';
const DEV_DOCS = '/abs/path/mcp-servers/simple-task-manager/CLAUDE.md';

describe('updateGlobalImport — what --global writes into the global CLAUDE.md', () => {
  test('appends the import to an empty file', () => {
    const { content, action } = updateGlobalImport('', SETUP);
    assert.equal(action, 'added');
    assert.equal(content, `@${SETUP}\n`);
  });

  test('separates the import when the file has no trailing newline', () => {
    const { content, action } = updateGlobalImport('# Rules\nBe nice.', SETUP);
    assert.equal(action, 'added');
    assert.equal(content, `# Rules\nBe nice.\n@${SETUP}\n`);
  });

  test('does not double up the newline when the file already ends with one', () => {
    const { content } = updateGlobalImport('# Rules\n', SETUP);
    assert.equal(content, `# Rules\n@${SETUP}\n`);
  });

  test('migrates an old CLAUDE.md import to SETUP.md in place', () => {
    const existing = `# Rules\nBe nice.\n@${DEV_DOCS}\n`;
    const { content, action } = updateGlobalImport(existing, SETUP);
    assert.equal(action, 'migrated');
    assert.equal(content, `# Rules\nBe nice.\n@${SETUP}\n`);
    assert.ok(!content.includes(DEV_DOCS), 'the dev-docs import must be gone, not merely joined');
  });

  test('migrating rewrites in place and keeps surrounding content ordered', () => {
    const existing = `# Top\n@${DEV_DOCS}\n# Bottom\n`;
    const { content } = updateGlobalImport(existing, SETUP);
    assert.equal(content, `# Top\n@${SETUP}\n# Bottom\n`);
  });

  test('is a no-op once the import already points at SETUP.md', () => {
    const existing = `# Rules\n@${SETUP}\n`;
    const { content, action } = updateGlobalImport(existing, SETUP);
    assert.equal(action, 'unchanged');
    assert.equal(content, existing);
  });

  test('is idempotent — a second --global run changes nothing', () => {
    const first = updateGlobalImport(`@${DEV_DOCS}\n`, SETUP);
    const second = updateGlobalImport(first.content, SETUP);
    assert.equal(second.action, 'unchanged');
    assert.equal(second.content, first.content);
  });

  test('an unrelated @import is left alone', () => {
    const existing = `@/abs/path/other-tool/CLAUDE.md\n`;
    const { content, action } = updateGlobalImport(existing, SETUP);
    assert.equal(action, 'added');
    assert.ok(content.includes('/abs/path/other-tool/CLAUDE.md'), 'must not hijack another import');
    assert.ok(content.includes(`@${SETUP}`));
  });
});

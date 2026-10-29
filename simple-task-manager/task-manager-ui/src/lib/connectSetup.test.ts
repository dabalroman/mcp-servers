import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { addLine, mcpUrlFor, setupPrompt } from './connectSetup';

const input = { key: 'stm_abc-DEF_123', url: 'https://host.example/mcp' };

describe('mcpUrlFor', () => {
  it('appends /mcp to the origin', () => {
    expect(mcpUrlFor('http://localhost:7374')).toBe('http://localhost:7374/mcp');
    expect(mcpUrlFor('http://localhost:7374/')).toBe('http://localhost:7374/mcp');
  });
});

describe('addLine', () => {
  it('puts the key in the Authorization header, single-quoted', () => {
    expect(addLine(input)).toBe(
      `claude mcp add --transport http task-manager 'https://host.example/mcp' --header 'Authorization: Bearer stm_abc-DEF_123' --scope local`,
    );
  });

  it('bash passes the header through as one argument', () => {
    const args = addLine(input).replace(/^claude /, '');
    const out = execFileSync('bash', ['-c', `printf '%s\\n' ${args}`]).toString().split('\n');
    expect(out).toContain('Authorization: Bearer stm_abc-DEF_123');
  });

  it('a quote in the URL cannot break out of the argument', () => {
    expect(addLine({ ...input, url: `https://h/mcp' ; rm -rf ~ '` })).toContain(`'https://h/mcp ; rm -rf ~ '`);
  });
});

describe('setupPrompt', () => {
  it('carries the URL, default project and the add line', () => {
    const prompt = setupPrompt({ ...input, project: 'alpha' });
    expect(prompt).toContain('Server: https://host.example/mcp');
    expect(prompt).toContain('Default project: alpha');
    expect(prompt).toContain(addLine(input));
  });
});

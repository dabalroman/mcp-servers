import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkPlanText } from './mcp/planText.js';

describe('checkPlanText', () => {
  const ok = (input: Buffer | string, opts?: { allowEmpty?: boolean }): string => {
    const r = checkPlanText(input, opts);
    assert.ok(r.ok, r.ok ? '' : r.error);
    return r.text;
  };
  const rejected = (input: Buffer | string, pattern: RegExp, opts?: { allowEmpty?: boolean }): void => {
    const r = checkPlanText(input, opts);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, pattern);
  };

  test('markdown passes unchanged, tabs included', () => {
    assert.equal(ok(Buffer.from('# Plan\n\n- step é\t`code`\n')), '# Plan\n\n- step é\t`code`\n');
  });

  test('a leading BOM is stripped', () => {
    assert.equal(ok(Buffer.from('﻿# Plan')), '# Plan');
  });

  test('CRLF and lone CR become LF', () => {
    assert.equal(ok('a\r\nb\rc\n'), 'a\nb\nc\n');
  });

  test('NUL, ESC, DEL and a C1 control are rejected with the code point', () => {
    rejected('a\u0000b', /U\+0000 at offset 1/);
    rejected('a\u001b[31m', /U\+001B/);
    rejected('a\u007f', /U\+007F/);
    rejected('a\u0085', /U\+0085/);
  });

  test('invalid UTF-8 is rejected, not turned into U+FFFD', () => {
    rejected(Buffer.from([0x23, 0xc3, 0x28]), /not valid UTF-8/);
  });

  test('PNG and zip bytes are rejected', () => {
    rejected(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), /UTF-8|control/);
    rejected(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]), /control/);
  });

  test('empty and whitespace-only text is rejected unless allowEmpty', () => {
    rejected('', /empty/);
    rejected(' \n\t', /empty/);
    assert.equal(ok('', { allowEmpty: true }), '');
    assert.equal(ok('\r\n', { allowEmpty: true }), '\n');
  });
});

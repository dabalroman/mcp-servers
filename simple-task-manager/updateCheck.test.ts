import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkForUpdate, resetUpdateCheckCache } from './updateCheck.js';
import { VERSION } from './version.js';

function fetchReturning(ok: boolean, body: string): typeof fetch {
  return (async () => ({ ok, text: async () => body })) as unknown as typeof fetch;
}

describe('checkForUpdate', () => {
  beforeEach(() => {
    resetUpdateCheckCache();
  });

  test('parses the remote VERSION and reports "available" when local is lower', async () => {
    const remote = '9999-12-999';
    const result = await checkForUpdate({ fetchImpl: fetchReturning(true, `export const VERSION = '${remote}';\n`) });
    assert.deepEqual(result, { state: 'available', local: VERSION, remote });
  });

  test('reports "current" when remote is equal to or behind local', async () => {
    const equal = await checkForUpdate({ fetchImpl: fetchReturning(true, `export const VERSION = '${VERSION}';\n`) });
    assert.equal(equal.state, 'current');

    resetUpdateCheckCache();
    const behind = await checkForUpdate({ fetchImpl: fetchReturning(true, `export const VERSION = '0001-01-001';\n`) });
    assert.equal(behind.state, 'current');
  });

  test('caches within the TTL and refetches once it expires', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = (async () => {
      calls++;
      return { ok: true, text: async () => `export const VERSION = '9999-12-999';\n` };
    }) as unknown as typeof fetch;
    let now = 1_000;
    const nowFn = () => now;

    await checkForUpdate({ fetchImpl, now: nowFn });
    await checkForUpdate({ fetchImpl, now: nowFn });
    assert.equal(calls, 1);

    now += 60 * 60 * 1000 + 1;
    await checkForUpdate({ fetchImpl, now: nowFn });
    assert.equal(calls, 2);
  });

  test('network failure and an unparseable body are both cached as "unknown"', async () => {
    const rejecting = (async () => { throw new Error('boom'); }) as unknown as typeof fetch;
    const failed = await checkForUpdate({ fetchImpl: rejecting });
    assert.deepEqual(failed, { state: 'unknown', local: VERSION, remote: null });

    resetUpdateCheckCache();
    const garbled = await checkForUpdate({ fetchImpl: fetchReturning(true, 'not a version file') });
    assert.equal(garbled.state, 'unknown');
  });
});

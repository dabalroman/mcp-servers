import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrUrl, resolvePrLookup } from './prUrl.js';

describe('parsePrUrl', () => {
  test('GitHub pull url', () => {
    assert.deepEqual(parsePrUrl('https://github.com/Owner/Repo/pull/42'), { host: 'github.com', repo: 'owner/repo', number: 42 });
  });

  test('ignores trailing slash, /files suffix, query and fragment', () => {
    for (const suffix of ['/', '/files', '/files/', '?diff=split', '#issuecomment-1', '/commits?x=1#y']) {
      assert.deepEqual(parsePrUrl(`https://GitHub.com/o/r/pull/7${suffix}`), { host: 'github.com', repo: 'o/r', number: 7 }, suffix);
    }
  });

  test('GitLab merge request with nested groups', () => {
    assert.deepEqual(
      parsePrUrl('https://gitlab.example.com/Group/Sub/Project/-/merge_requests/12/diffs'),
      { host: 'gitlab.example.com', repo: 'group/sub/project', number: 12 },
    );
  });

  test('returns null for unparseable input', () => {
    for (const url of ['', 'not a url', 'ftp://github.com/o/r/pull/1', 'https://github.com/o/r', 'https://github.com/o/r/pull/x', 'https://github.com/o/r/pull/0', 'https://github.com/pull/3', 'https://github.com/o/r/issues/3']) {
      assert.equal(parsePrUrl(url), null, url);
    }
  });
});

describe('resolvePrLookup', () => {
  test('url resolves with host, repo + number without', () => {
    assert.deepEqual(resolvePrLookup({ url: 'https://github.com/O/R/pull/3' }), { host: 'github.com', repo: 'o/r', number: 3 });
    assert.deepEqual(resolvePrLookup({ repo: ' O/R/ ', number: 3 }), { repo: 'o/r', number: 3 });
  });

  test('rejects bad input with a Validation failed error', () => {
    for (const input of [{ url: 'nope' }, { number: 3 }, { repo: 'o/r' }, {}, { repo: 'solo', number: 1 }, { repo: 'o/r', number: 0 }, { repo: 'o/r', number: 1.5 }]) {
      assert.throws(() => resolvePrLookup(input), /^Error: Validation failed: /, JSON.stringify(input));
    }
  });
});

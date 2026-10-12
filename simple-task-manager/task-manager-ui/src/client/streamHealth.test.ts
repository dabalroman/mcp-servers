import { describe, it, expect } from 'vitest';
import { shouldRefetchOnReturn, isStreamStale } from './streamHealth';

describe('shouldRefetchOnReturn', () => {
  it('is false when the tab was never hidden', () => {
    expect(shouldRefetchOnReturn(null, 1_000_000)).toBe(false);
  });
  it('is false just under 30s', () => {
    expect(shouldRefetchOnReturn(0, 29_999)).toBe(false);
  });
  it('is true at 30s', () => {
    expect(shouldRefetchOnReturn(0, 30_000)).toBe(true);
  });
});

describe('isStreamStale', () => {
  it('is false just under 45s', () => {
    expect(isStreamStale(0, 44_999)).toBe(false);
  });
  it('is true at 45s', () => {
    expect(isStreamStale(0, 45_000)).toBe(true);
  });
});

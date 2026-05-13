import { describe, it, expect, beforeEach } from 'vitest';
import { getCollapseMap, setCollapsed, isCollapsed, toggleCollapsed } from './collapseState';

function makeStorage(): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; _data: Record<string, string> } {
  const _data: Record<string, string> = {};
  return {
    _data,
    getItem: (k: string) => _data[k] ?? null,
    setItem: (k: string, v: string) => { _data[k] = v; },
  };
}

const KEY = 'test-collapse';

describe('getCollapseMap', () => {
  it('returns empty map when nothing stored', () => {
    const store = makeStorage();
    expect(getCollapseMap(store, KEY)).toEqual({});
  });

  it('returns empty map for invalid JSON', () => {
    const store = makeStorage();
    store._data[KEY] = '{not valid json';
    expect(getCollapseMap(store, KEY)).toEqual({});
  });

  it('returns empty map when stored value is not an object', () => {
    const store = makeStorage();
    store._data[KEY] = JSON.stringify([1, 2, 3]);
    expect(getCollapseMap(store, KEY)).toEqual({});
  });

  it('returns parsed map', () => {
    const store = makeStorage();
    store._data[KEY] = JSON.stringify({ 'scope-a': true });
    expect(getCollapseMap(store, KEY)).toEqual({ 'scope-a': true });
  });
});

describe('isCollapsed', () => {
  it('returns false for unknown key (default expanded)', () => {
    const store = makeStorage();
    expect(isCollapsed(store, KEY, 'new-scope')).toBe(false);
  });

  it('returns stored value', () => {
    const store = makeStorage();
    setCollapsed(store, KEY, 'scope-a', true);
    expect(isCollapsed(store, KEY, 'scope-a')).toBe(true);
  });
});

describe('setCollapsed', () => {
  it('persists collapsed state', () => {
    const store = makeStorage();
    setCollapsed(store, KEY, 'scope-a', true);
    expect(isCollapsed(store, KEY, 'scope-a')).toBe(true);
  });

  it('preserves other keys when updating one', () => {
    const store = makeStorage();
    setCollapsed(store, KEY, 'scope-a', true);
    setCollapsed(store, KEY, 'scope-b', false);
    expect(isCollapsed(store, KEY, 'scope-a')).toBe(true);
    expect(isCollapsed(store, KEY, 'scope-b')).toBe(false);
  });
});

describe('toggleCollapsed', () => {
  let store: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    store = makeStorage();
  });

  it('toggles from expanded (false) to collapsed (true)', () => {
    const result = toggleCollapsed(store, KEY, 'scope-a');
    expect(result).toBe(true);
    expect(isCollapsed(store, KEY, 'scope-a')).toBe(true);
  });

  it('toggles from collapsed (true) to expanded (false)', () => {
    setCollapsed(store, KEY, 'scope-a', true);
    const result = toggleCollapsed(store, KEY, 'scope-a');
    expect(result).toBe(false);
    expect(isCollapsed(store, KEY, 'scope-a')).toBe(false);
  });

  it('returns the new state', () => {
    expect(toggleCollapsed(store, KEY, 'x')).toBe(true);
    expect(toggleCollapsed(store, KEY, 'x')).toBe(false);
    expect(toggleCollapsed(store, KEY, 'x')).toBe(true);
  });
});

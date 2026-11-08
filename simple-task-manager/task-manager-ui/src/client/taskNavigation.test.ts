import { describe, it, expect } from 'vitest';
import { findTaskLocation } from './taskNavigation';
import type { Task } from '@/types/task';

function makeTask(overrides: Partial<Task> & { id: number; title: string }): Task {
  return {
    type: 'bug',
    priority: 'medium',
    status: 'todo',
    project: 'example-project',
    externalId: null,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ...overrides,
  };
}

const active: Task[] = [
  makeTask({ id: 1, title: 'Active with scope', scope: 'svg-path-joiner' }),
  makeTask({ id: 2, title: 'Active no scope' }),
];

const done: Task[] = [
  makeTask({ id: 3, title: 'Done with scope', scope: 'eink-frame', status: 'done' }),
  makeTask({ id: 4, title: 'Done no scope', status: 'done' }),
];

describe('findTaskLocation', () => {
  it('finds a task in active with its scope (groupBy=scope)', () => {
    const result = findTaskLocation(active, done, 1, 'scope', 'priority', 'desc');
    expect(result).toEqual({ tab: 'active', sectionValue: 'svg-path-joiner' });
  });

  it('uses (no scope) label for active task without scope', () => {
    const result = findTaskLocation(active, done, 2, 'scope', 'priority', 'desc');
    expect(result).toEqual({ tab: 'active', sectionValue: '(no scope)' });
  });

  it('finds a task in done with its scope', () => {
    const result = findTaskLocation(active, done, 3, 'scope', 'priority', 'desc');
    expect(result).toEqual({ tab: 'done', sectionValue: 'eink-frame' });
  });

  it('uses (no scope) label for done task without scope', () => {
    const result = findTaskLocation(active, done, 4, 'scope', 'priority', 'desc');
    expect(result).toEqual({ tab: 'done', sectionValue: '(no scope)' });
  });

  it('returns null when id is not found in either list', () => {
    const result = findTaskLocation(active, done, 999, 'scope', 'priority', 'desc');
    expect(result).toBeNull();
  });

  it('prefers active over done when id appears in both', () => {
    const crossActive: Task[] = [makeTask({ id: 3, title: 'Also active', scope: 'task-manager' })];
    const result = findTaskLocation(crossActive, done, 3, 'scope', 'priority', 'desc');
    expect(result).toEqual({ tab: 'active', sectionValue: 'task-manager' });
  });

  it('uses status as sectionValue when groupBy=status', () => {
    const result = findTaskLocation(active, done, 1, 'status', 'priority', 'desc');
    expect(result).toEqual({ tab: 'active', sectionValue: 'todo' });
  });

  it('uses priority as sectionValue when groupBy=priority', () => {
    const result = findTaskLocation(active, done, 1, 'priority', 'priority', 'desc');
    expect(result).toEqual({ tab: 'active', sectionValue: 'medium' });
  });

  it('returns empty string sectionValue when groupBy=none', () => {
    const result = findTaskLocation(active, done, 1, 'none', 'priority', 'desc');
    expect(result).toEqual({ tab: 'active', sectionValue: '' });
  });

  it('uses the epic\'s section for a child nested under an epic in the same tab', () => {
    const epic = makeTask({ id: 10, title: 'Epic', type: 'epic', status: 'in_progress' });
    const child = makeTask({ id: 11, title: 'Child', parentId: 10, status: 'todo' });
    expect(findTaskLocation([epic, child], [], 11, 'status', 'priority', 'desc')).toEqual({ tab: 'active', sectionValue: 'in_progress' });
    const doneChild = makeTask({ id: 12, title: 'Done child', parentId: 10, status: 'done' });
    expect(findTaskLocation([epic], [doneChild], 12, 'status', 'priority', 'desc')).toEqual({ tab: 'done', sectionValue: 'done' });
  });

  it('resolves a done child of an open epic, and the epic itself, against the Done tab\'s pulled-in block', () => {
    const epic = makeTask({ id: 20, title: 'Open epic', type: 'epic', status: 'in_progress', scope: 'example-scope' });
    const openChild = makeTask({ id: 21, title: 'Open child', parentId: 20, type: 'feature', priority: 'critical', scope: 'example-scope' });
    const doneBug = makeTask({ id: 22, title: 'Done bug', parentId: 20, type: 'bug', priority: 'high', status: 'done', scope: 'example-scope' });
    const doneFeature = makeTask({ id: 23, title: 'Done feature', parentId: 20, type: 'feature', priority: 'low', status: 'done', scope: 'example-scope' });
    const a = [epic, openChild];
    const d = [doneBug, doneFeature];
    expect(findTaskLocation(a, d, 23, 'status', 'priority', 'desc')).toEqual({ tab: 'done', sectionValue: 'done' });
    // The block follows its first done child by the current sort.
    expect(findTaskLocation(a, d, 23, 'type', 'priority', 'desc')).toEqual({ tab: 'done', sectionValue: 'bug' });
    expect(findTaskLocation(a, d, 23, 'type', 'priority', 'asc')).toEqual({ tab: 'done', sectionValue: 'feature' });
    expect(findTaskLocation(a, d, 22, 'scope', 'priority', 'desc')).toEqual({ tab: 'done', sectionValue: 'example-scope' });
    // Open epic and open children belong to the Active tab.
    expect(findTaskLocation(a, d, 20, 'status', 'priority', 'desc')).toEqual({ tab: 'active', sectionValue: 'in_progress' });
    expect(findTaskLocation(a, d, 21, 'status', 'priority', 'desc')).toEqual({ tab: 'active', sectionValue: 'in_progress' });
  });
});

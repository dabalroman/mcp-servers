import { describe, it, expect } from 'vitest';
import { findTaskLocation } from './taskNavigation';
import type { Task } from '@/types/task';

function makeTask(overrides: Partial<Task> & { id: number; title: string }): Task {
  return {
    type: 'bug',
    priority: 'medium',
    status: 'todo',
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
    const result = findTaskLocation(active, done, 1, 'scope');
    expect(result).toEqual({ tab: 'active', sectionValue: 'svg-path-joiner' });
  });

  it('uses (no scope) label for active task without scope', () => {
    const result = findTaskLocation(active, done, 2, 'scope');
    expect(result).toEqual({ tab: 'active', sectionValue: '(no scope)' });
  });

  it('finds a task in done with its scope', () => {
    const result = findTaskLocation(active, done, 3, 'scope');
    expect(result).toEqual({ tab: 'done', sectionValue: 'eink-frame' });
  });

  it('uses (no scope) label for done task without scope', () => {
    const result = findTaskLocation(active, done, 4, 'scope');
    expect(result).toEqual({ tab: 'done', sectionValue: '(no scope)' });
  });

  it('returns null when id is not found in either list', () => {
    const result = findTaskLocation(active, done, 999, 'scope');
    expect(result).toBeNull();
  });

  it('prefers active over done when id appears in both', () => {
    const crossActive: Task[] = [makeTask({ id: 3, title: 'Also active', scope: 'task-manager' })];
    const result = findTaskLocation(crossActive, done, 3, 'scope');
    expect(result).toEqual({ tab: 'active', sectionValue: 'task-manager' });
  });

  it('uses status as sectionValue when groupBy=status', () => {
    const result = findTaskLocation(active, done, 1, 'status');
    expect(result).toEqual({ tab: 'active', sectionValue: 'todo' });
  });

  it('uses priority as sectionValue when groupBy=priority', () => {
    const result = findTaskLocation(active, done, 1, 'priority');
    expect(result).toEqual({ tab: 'active', sectionValue: 'medium' });
  });

  it('returns empty string sectionValue when groupBy=none', () => {
    const result = findTaskLocation(active, done, 1, 'none');
    expect(result).toEqual({ tab: 'active', sectionValue: '' });
  });
});

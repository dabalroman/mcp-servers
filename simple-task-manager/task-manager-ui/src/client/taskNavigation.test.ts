import { describe, it, expect } from 'vitest';
import { findTaskLocation } from './taskNavigation';
import type { Task } from '@/types/task';

function makeTask(overrides: Partial<Task> & { id: number; title: string }): Task {
  return {
    type: 'bug',
    priority: 'medium',
    status: 'todo',
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
  it('finds a task in active with its scope', () => {
    const result = findTaskLocation(active, done, 1);
    expect(result).toEqual({ tab: 'active', scope: 'svg-path-joiner' });
  });

  it('uses (no scope) label for active task without scope', () => {
    const result = findTaskLocation(active, done, 2);
    expect(result).toEqual({ tab: 'active', scope: '(no scope)' });
  });

  it('finds a task in done with its scope', () => {
    const result = findTaskLocation(active, done, 3);
    expect(result).toEqual({ tab: 'done', scope: 'eink-frame' });
  });

  it('uses (no scope) label for done task without scope', () => {
    const result = findTaskLocation(active, done, 4);
    expect(result).toEqual({ tab: 'done', scope: '(no scope)' });
  });

  it('returns null when id is not found in either list', () => {
    const result = findTaskLocation(active, done, 999);
    expect(result).toBeNull();
  });

  it('prefers active over done when id appears in both', () => {
    const crossActive: Task[] = [makeTask({ id: 3, title: 'Also active', scope: 'task-manager' })];
    const result = findTaskLocation(crossActive, done, 3);
    expect(result).toEqual({ tab: 'active', scope: 'task-manager' });
  });
});

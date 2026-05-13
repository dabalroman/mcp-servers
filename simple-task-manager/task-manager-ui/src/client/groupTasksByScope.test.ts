import { describe, it, expect } from 'vitest';
import { groupTasksByScope } from './groupTasksByScope';
import type { Task } from '@/types/task';

function task(overrides: Partial<Task> & { id: number; title: string }): Task {
  return { type: 'bug', priority: 'medium', status: 'todo', ...overrides };
}

describe('groupTasksByScope', () => {
  it('groups tasks by scope key', () => {
    const tasks = [
      task({ id: 1, title: 'A', scope: 'alpha' }),
      task({ id: 2, title: 'B', scope: 'alpha' }),
      task({ id: 3, title: 'C', scope: 'beta' }),
    ];
    const groups = groupTasksByScope(tasks, 'active');
    expect(groups.map((g) => g.scope)).toEqual(['alpha', 'beta']);
    expect(groups[0]?.tasks).toHaveLength(2);
  });

  it('uses (no scope) label for tasks without scope', () => {
    const tasks = [
      task({ id: 1, title: 'A' }),
      task({ id: 2, title: 'B', scope: 'alpha' }),
    ];
    const groups = groupTasksByScope(tasks, 'active');
    expect(groups.map((g) => g.scope)).toEqual(['alpha', '(no scope)']);
  });

  it('sorts scopes alphabetically, no-scope last', () => {
    const tasks = [
      task({ id: 1, title: 'A', scope: 'zeta' }),
      task({ id: 2, title: 'B' }),
      task({ id: 3, title: 'C', scope: 'alpha' }),
    ];
    const groups = groupTasksByScope(tasks, 'active');
    expect(groups.map((g) => g.scope)).toEqual(['alpha', 'zeta', '(no scope)']);
  });

  it('done mode: sorts tasks by id descending within scope', () => {
    const tasks = [
      task({ id: 1, title: 'Old', scope: 'alpha', status: 'done' }),
      task({ id: 5, title: 'New', scope: 'alpha', status: 'done' }),
    ];
    const groups = groupTasksByScope(tasks, 'done');
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual([5, 1]);
  });

  it('does not mutate the input array', () => {
    const tasks = [
      task({ id: 2, title: 'B', status: 'done' }),
      task({ id: 1, title: 'A', status: 'done' }),
    ];
    const copy = [...tasks];
    groupTasksByScope(tasks, 'done');
    expect(tasks).toEqual(copy);
  });
});

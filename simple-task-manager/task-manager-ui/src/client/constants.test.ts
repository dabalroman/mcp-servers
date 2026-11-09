import { describe, it, expect } from 'vitest';
import { sortByPriority, TYPES, TYPE_ORDER, TYPE_LABELS, STATUS_LABELS, STATUS_CLASSES, STATUS_NEXT, PR_STATUS_CLASSES, PR_STATUS_ICONS } from './constants';
import { PR_STATUSES } from '../../../tasks.js';
import type { Task } from '@/types/task';

function task(id: number, priority: Task['priority']): Task {
  return { id, priority, type: 'feature', status: 'todo', project: 'example-project', title: `task ${id}`, description: '', externalId: null, created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00' };
}

describe('STATUS constants — refinement', () => {
  it('includes refinement in STATUS_LABELS', () => {
    expect(STATUS_LABELS.refinement).toBe('REFINEMENT');
  });

  it('STATUS_NEXT cycles: refinement → plan → todo → in_progress → done → refinement', () => {
    expect(STATUS_NEXT.refinement).toBe('plan');
    expect(STATUS_NEXT.plan).toBe('todo');
    expect(STATUS_NEXT.todo).toBe('in_progress');
    expect(STATUS_NEXT.in_progress).toBe('done');
    expect(STATUS_NEXT.done).toBe('refinement');
  });

  it('refinement has a distinct STATUS_CLASSES entry', () => {
    expect(STATUS_CLASSES.refinement).toBeTruthy();
    expect(STATUS_CLASSES.refinement).not.toBe(STATUS_CLASSES.plan);
    expect(STATUS_CLASSES.refinement).not.toBe(STATUS_CLASSES.todo);
    expect(STATUS_CLASSES.refinement).not.toBe(STATUS_CLASSES.in_progress);
    expect(STATUS_CLASSES.refinement).not.toBe(STATUS_CLASSES.done);
  });

  it('plan has a distinct STATUS_CLASSES entry', () => {
    expect(STATUS_CLASSES.plan).toBeTruthy();
    expect(STATUS_CLASSES.plan).not.toBe(STATUS_CLASSES.refinement);
    expect(STATUS_CLASSES.plan).not.toBe(STATUS_CLASSES.todo);
    expect(STATUS_CLASSES.plan).not.toBe(STATUS_CLASSES.in_progress);
    expect(STATUS_CLASSES.plan).not.toBe(STATUS_CLASSES.done);
  });
});

describe('sortByPriority', () => {
  it('sorts critical before high before medium before low', () => {
    const input = [task(1, 'low'), task(2, 'medium'), task(3, 'high'), task(4, 'critical')];
    const result = sortByPriority(input);
    expect(result.map(t => t.priority)).toEqual(['critical', 'high', 'medium', 'low']);
  });

  it('breaks priority ties by id descending (FILO)', () => {
    const input = [task(1, 'high'), task(3, 'high'), task(2, 'high')];
    const result = sortByPriority(input);
    expect(result.map(t => t.id)).toEqual([3, 2, 1]);
  });

  it('does not mutate the input array', () => {
    const input = [task(1, 'low'), task(2, 'critical')];
    const original = [...input];
    sortByPriority(input);
    expect(input).toEqual(original);
  });

  it('handles single-element array', () => {
    expect(sortByPriority([task(1, 'medium')])).toHaveLength(1);
  });

  it('handles empty array', () => {
    expect(sortByPriority([])).toEqual([]);
  });
});

describe('epic type', () => {
  it('is labelled and sorts last in TYPES and TYPE_ORDER', () => {
    expect(TYPE_LABELS.epic).toBe('EPIC');
    expect(TYPES[TYPES.length - 1]).toBe('epic');
    expect(TYPE_ORDER[TYPE_ORDER.length - 1]).toBe('epic');
  });
});

describe('PR_STATUS_CLASSES', () => {
  it('covers every PR status the store accepts', () => {
    expect(Object.keys(PR_STATUS_CLASSES).sort()).toEqual([...PR_STATUSES].sort());
  });
});

describe('PR_STATUS_ICONS', () => {
  it('gives every PR status its own distinct icon', () => {
    expect(Object.keys(PR_STATUS_ICONS).sort()).toEqual([...PR_STATUSES].sort());
    expect(new Set(Object.values(PR_STATUS_ICONS)).size).toBe(PR_STATUSES.length);
  });
});

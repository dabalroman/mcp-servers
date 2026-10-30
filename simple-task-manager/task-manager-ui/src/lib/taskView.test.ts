import { describe, it, expect } from 'vitest';
import { sortTasks, groupTasks, getSectionValue, nestEpicChildren, epicProgress, filterByProject, matchesTaskQuery, pickProject, projectFromPath, projectPath } from './taskView';
import type { SortDir } from './taskView';
import type { Task } from '@/types/task';

function makeTask(partial: Partial<Task> & { id: number }): Task {
  return {
    type: 'feature',
    priority: 'medium',
    status: 'todo',
    project: 'example-project',
    externalId: null,
    title: `Task ${partial.id}`,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ...partial,
  };
}

const TASKS: Task[] = [
  makeTask({ id: 1, priority: 'low',      status: 'done',        type: 'bug',     scope: 'api',  created_at: '2026-01-01T10:00:00', updated_at: '2026-01-04T10:00:00' }),
  makeTask({ id: 2, priority: 'critical', status: 'in_progress', type: 'feature', scope: 'api',  created_at: '2026-01-02T10:00:00', updated_at: '2026-01-03T10:00:00' }),
  makeTask({ id: 3, priority: 'high',     status: 'todo',        type: 'tool',    scope: 'auth', created_at: '2026-01-03T10:00:00', updated_at: '2026-01-02T10:00:00' }),
  makeTask({ id: 4, priority: 'medium',   status: 'refinement',  type: 'idea',                   created_at: '2026-01-04T10:00:00', updated_at: '2026-01-01T10:00:00' }),
];

describe('sortTasks', () => {
  it('priority desc — critical first', () => {
    const sorted = sortTasks(TASKS, 'priority', 'desc');
    expect(sorted[0]!.id).toBe(2);
    expect(sorted[1]!.id).toBe(3);
    expect(sorted[2]!.id).toBe(4);
    expect(sorted[3]!.id).toBe(1);
  });

  it('priority asc — low first', () => {
    const sorted = sortTasks(TASKS, 'priority', 'asc');
    expect(sorted[0]!.id).toBe(1);
    expect(sorted[1]!.id).toBe(4);
    expect(sorted[2]!.id).toBe(3);
    expect(sorted[3]!.id).toBe(2);
  });

  it('status desc — in_progress first', () => {
    const sorted = sortTasks(TASKS, 'status', 'desc');
    expect(sorted[0]!.id).toBe(2);
    expect(sorted[1]!.id).toBe(3);
    expect(sorted[2]!.id).toBe(4);
    expect(sorted[3]!.id).toBe(1);
  });

  it('status asc — done first', () => {
    const sorted = sortTasks(TASKS, 'status', 'asc');
    expect(sorted[0]!.id).toBe(1);
    expect(sorted[1]!.id).toBe(4);
    expect(sorted[2]!.id).toBe(3);
    expect(sorted[3]!.id).toBe(2);
  });

  it('created_at asc — oldest first', () => {
    expect(sortTasks(TASKS, 'created_at', 'asc').map((t) => t.id)).toEqual([1, 2, 3, 4]);
  });

  it('created_at desc — newest first', () => {
    expect(sortTasks(TASKS, 'created_at', 'desc').map((t) => t.id)).toEqual([4, 3, 2, 1]);
  });

  it('updated_at desc — most recently updated first', () => {
    const sorted = sortTasks(TASKS, 'updated_at', 'desc');
    expect(sorted[0]!.id).toBe(1);
    expect(sorted[3]!.id).toBe(4);
  });

  it('updated_at asc — least recently updated first', () => {
    const sorted = sortTasks(TASKS, 'updated_at', 'asc');
    expect(sorted[0]!.id).toBe(4);
    expect(sorted[3]!.id).toBe(1);
  });

  it('empty input returns empty array', () => {
    expect(sortTasks([], 'priority', 'desc')).toEqual([]);
  });

  it('secondary sort by id desc within same priority', () => {
    const tasks = [
      makeTask({ id: 1, priority: 'high' }),
      makeTask({ id: 3, priority: 'high' }),
      makeTask({ id: 2, priority: 'high' }),
    ];
    expect(sortTasks(tasks, 'priority', 'desc').map((t) => t.id)).toEqual([3, 2, 1]);
  });
});

describe('groupTasks', () => {
  it('none — single section with all tasks', () => {
    const sections = groupTasks(TASKS, 'none');
    expect(sections).toHaveLength(1);
    expect(sections[0]!.value).toBe('');
    expect(sections[0]!.tasks).toHaveLength(TASKS.length);
  });

  it('scope — alphabetical, (no scope) last', () => {
    const sections = groupTasks(TASKS, 'scope', 'asc');
    expect(sections).toHaveLength(3);
    expect(sections[0]!.value).toBe('api');
    expect(sections[1]!.value).toBe('auth');
    expect(sections[2]!.value).toBe('(no scope)');
  });

  it('scope — correct task counts per section', () => {
    const sections = groupTasks(TASKS, 'scope', 'asc');
    expect(sections.find((s) => s.value === 'api')!.tasks).toHaveLength(2);
    expect(sections.find((s) => s.value === 'auth')!.tasks).toHaveLength(1);
    expect(sections.find((s) => s.value === '(no scope)')!.tasks).toHaveLength(1);
  });

  it('status desc — canonical order: in_progress, todo, refinement, done', () => {
    expect(groupTasks(TASKS, 'status', 'desc').map((s) => s.value)).toEqual(['in_progress', 'todo', 'refinement', 'done']);
  });

  it('status asc — reversed: done, refinement, todo, in_progress', () => {
    expect(groupTasks(TASKS, 'status', 'asc').map((s) => s.value)).toEqual(['done', 'refinement', 'todo', 'in_progress']);
  });

  it('type — canonical order: bug, tool, feature, idea (other absent)', () => {
    expect(groupTasks(TASKS, 'type', 'desc').map((s) => s.value)).toEqual(['bug', 'tool', 'feature', 'idea']);
  });

  it('priority desc — canonical order: critical, high, medium, low', () => {
    expect(groupTasks(TASKS, 'priority', 'desc').map((s) => s.value)).toEqual(['critical', 'high', 'medium', 'low']);
  });

  it('priority asc — reversed: low, medium, high, critical', () => {
    expect(groupTasks(TASKS, 'priority', 'asc').map((s) => s.value)).toEqual(['low', 'medium', 'high', 'critical']);
  });

  it('scope asc — alphabetical A→Z, (no scope) last', () => {
    const sections = groupTasks(TASKS, 'scope', 'asc');
    expect(sections[0]!.value).toBe('api');
    expect(sections[1]!.value).toBe('auth');
    expect(sections[2]!.value).toBe('(no scope)');
  });

  it('scope desc — reverse alphabetical Z→A, (no scope) last', () => {
    const sections = groupTasks(TASKS, 'scope', 'desc');
    expect(sections[0]!.value).toBe('auth');
    expect(sections[1]!.value).toBe('api');
    expect(sections[2]!.value).toBe('(no scope)');
  });

  it('empty input returns one empty section for none', () => {
    const sections = groupTasks([], 'none');
    expect(sections).toHaveLength(1);
    expect(sections[0]!.tasks).toHaveLength(0);
  });

  it('empty input returns empty array for scoped grouping', () => {
    expect(groupTasks([], 'scope')).toHaveLength(0);
    expect(groupTasks([], 'status')).toHaveLength(0);
    expect(groupTasks([], 'priority')).toHaveLength(0);
  });

  it('all tasks in one group — single section', () => {
    const tasks = TASKS.map((t) => ({ ...t, scope: 'one' }));
    const sections = groupTasks(tasks, 'scope', 'asc');
    expect(sections).toHaveLength(1);
    expect(sections[0]!.value).toBe('one');
    expect(sections[0]!.tasks).toHaveLength(tasks.length);
  });

  it('tasks retain their incoming order within sections', () => {
    const tasks = [makeTask({ id: 5, scope: 'x' }), makeTask({ id: 3, scope: 'x' }), makeTask({ id: 7, scope: 'x' })];
    expect(groupTasks(tasks, 'scope', 'asc')[0]!.tasks.map((t) => t.id)).toEqual([5, 3, 7]);
  });
});

describe('getSectionValue', () => {
  const t = makeTask({ id: 1, scope: 'api', status: 'todo', type: 'bug', priority: 'high' });

  it('scope', () => expect(getSectionValue(t, 'scope')).toBe('api'));
  it('scope fallback for missing scope', () => expect(getSectionValue(makeTask({ id: 1 }), 'scope')).toBe('(no scope)'));
  it('status', () => expect(getSectionValue(t, 'status')).toBe('todo'));
  it('type', () => expect(getSectionValue(t, 'type')).toBe('bug'));
  it('priority', () => expect(getSectionValue(t, 'priority')).toBe('high'));
  it('none', () => expect(getSectionValue(t, 'none')).toBe(''));
});

describe('nestEpicChildren', () => {
  const epic = makeTask({ id: 10, type: 'epic' });
  const a = makeTask({ id: 11, parentId: 10 });
  const b = makeTask({ id: 12, parentId: 10 });
  const orphan = makeTask({ id: 13, parentId: 99 });
  const plain = makeTask({ id: 14 });

  it('nests children under an epic in the same list, preserving order', () => {
    const { roots, childrenByEpic } = nestEpicChildren([a, epic, b, plain]);
    expect(roots.map((t) => t.id)).toEqual([10, 14]);
    expect(childrenByEpic.get(10)!.map((t) => t.id)).toEqual([11, 12]);
  });

  it('keeps a child flat when its epic is not in the list', () => {
    const { roots, childrenByEpic } = nestEpicChildren([orphan, plain]);
    expect(roots.map((t) => t.id)).toEqual([13, 14]);
    expect(childrenByEpic.size).toBe(0);
  });

  it('leaves an epic with no children as a plain root', () => {
    const { roots, childrenByEpic } = nestEpicChildren([epic]);
    expect(roots).toEqual([epic]);
    expect(childrenByEpic.size).toBe(0);
  });
});

describe('epicProgress', () => {
  it('counts done and total children per epic across the given tasks', () => {
    const p = epicProgress([
      makeTask({ id: 1, parentId: 10, status: 'done' }),
      makeTask({ id: 2, parentId: 10, status: 'todo' }),
      makeTask({ id: 3, parentId: 20, status: 'done' }),
      makeTask({ id: 4 }),
    ]);
    expect(p.get(10)).toEqual({ done: 1, total: 2 });
    expect(p.get(20)).toEqual({ done: 1, total: 1 });
    expect(p.has(4)).toBe(false);
  });
});

describe('filterByProject', () => {
  it('keeps only tasks of the given project, ignoring case', () => {
    const tasks = [makeTask({ id: 1, project: 'a-project' }), makeTask({ id: 2, project: 'b-project' }), makeTask({ id: 3, project: 'A-Project' })];
    expect(filterByProject(tasks, 'a-project').map((t) => t.id)).toEqual([1, 3]);
    expect(filterByProject(tasks, 'nope')).toEqual([]);
  });
});

describe('matchesTaskQuery', () => {
  const task = makeTask({ id: 371, title: 'Use the References picker' });

  it('matches everything on an empty query', () => {
    expect(matchesTaskQuery(task, '')).toBe(true);
  });

  it('matches by id with or without the hash', () => {
    expect(matchesTaskQuery(task, '37')).toBe(true);
    expect(matchesTaskQuery(task, '#371')).toBe(true);
    expect(matchesTaskQuery(task, '#71')).toBe(false);
  });

  it('matches the title ignoring case', () => {
    expect(matchesTaskQuery(task, 'references PICK')).toBe(true);
    expect(matchesTaskQuery(task, 'epic')).toBe(false);
  });
});

describe('pickProject', () => {
  it('returns the remembered project when it still exists, in its stored spelling', () => {
    expect(pickProject(['b-project', 'A-Project'], 'a-project')).toBe('A-Project');
  });

  it('falls back to the first project alphabetically', () => {
    expect(pickProject(['b-project', 'a-project'], 'gone')).toBe('a-project');
    expect(pickProject(['b-project', 'a-project'], null)).toBe('a-project');
  });

  it('returns null when there are no projects', () => {
    expect(pickProject([], 'a-project')).toBeNull();
  });
});

describe('projectFromPath / projectPath', () => {
  it('reads the first path segment', () => {
    expect(projectFromPath('/')).toBeNull();
    expect(projectFromPath('')).toBeNull();
    expect(projectFromPath('/a-project')).toBe('a-project');
    expect(projectFromPath('/a-project/')).toBe('a-project');
    expect(projectFromPath('/a-project/extra')).toBe('a-project');
  });

  it('round-trips names that need encoding', () => {
    for (const name of ['my project', 'zażółć', 'a/b', 'x?y#z']) {
      expect(projectFromPath(projectPath(name))).toBe(name);
    }
  });

  it('returns null for malformed percent-encoding', () => {
    expect(projectFromPath('/%E2')).toBeNull();
  });
});

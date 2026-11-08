import { describe, it, expect } from 'vitest';
import { sortTasks, groupTasks, getSectionValue, nestEpicChildren, countOwnTasks, epicProgress, filterByProject, matchesTaskQuery, pickProject, projectFromPath, projectPath, defaultView, nextView } from './taskView';
import type { CardView, SortDir } from './taskView';
import type { Task, TaskStatus } from '@/types/task';

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
  const epic = makeTask({ id: 10, type: 'epic', status: 'in_progress' });
  const a = makeTask({ id: 11, parentId: 10, priority: 'low' });
  const b = makeTask({ id: 12, parentId: 10, priority: 'high' });
  const orphan = makeTask({ id: 13, parentId: 99 });
  const plain = makeTask({ id: 14 });
  const ids = (ts: Task[] | undefined) => (ts ?? []).map((t) => t.id);

  it('nests children under an epic in the same list, ordered by the sort', () => {
    const { roots, childrenByEpic } = nestEpicChildren([a, epic, b, plain], [], 'priority', 'desc');
    expect(ids(roots)).toEqual([14, 10]);
    expect(ids(childrenByEpic.get(10))).toEqual([12, 11]);
  });

  it('keeps a child flat when its epic is not in the list', () => {
    const { roots, childrenByEpic } = nestEpicChildren([orphan, plain], [], 'priority', 'desc');
    expect(ids(roots)).toEqual([14, 13]);
    expect(childrenByEpic.size).toBe(0);
  });

  it('leaves an epic with no children as a plain root', () => {
    const { roots, childrenByEpic } = nestEpicChildren([epic], [], 'priority', 'desc');
    expect(roots).toEqual([epic]);
    expect(childrenByEpic.size).toBe(0);
  });

  it('interleaves other-tab children with own ones by the current sort, never as roots', () => {
    const doneMid = makeTask({ id: 15, parentId: 10, status: 'done', priority: 'medium' });
    const doneCrit = makeTask({ id: 16, parentId: 10, status: 'done', priority: 'critical' });
    const unrelatedDone = makeTask({ id: 17, status: 'done' });
    const { roots, childrenByEpic } = nestEpicChildren([a, epic, b], [doneMid, doneCrit, unrelatedDone], 'priority', 'desc');
    expect(ids(roots)).toEqual([10]);
    expect(ids(childrenByEpic.get(10))).toEqual([16, 12, 15, 11]);
    const asc = nestEpicChildren([a, epic, b], [doneMid, doneCrit], 'priority', 'asc');
    expect(ids(asc.childrenByEpic.get(10))).toEqual([11, 15, 12, 16]);
  });

  it('lists an epic whose children are all in the other tab', () => {
    const d1 = makeTask({ id: 18, parentId: 10, status: 'done', created_at: '2026-01-02T00:00:00' });
    const d2 = makeTask({ id: 19, parentId: 10, status: 'done', created_at: '2026-01-03T00:00:00' });
    const { roots, childrenByEpic } = nestEpicChildren([epic, plain], [d1, d2], 'created_at', 'asc');
    expect(ids(roots)).toEqual([14, 10]);
    expect(ids(childrenByEpic.get(10))).toEqual([18, 19]);
  });

  it('nests across Group by = status: a child never forms its own group', () => {
    const doneChild = makeTask({ id: 20, parentId: 10, status: 'done' });
    const { roots, childrenByEpic } = nestEpicChildren([epic, a, plain], [doneChild], 'priority', 'desc');
    const sections = groupTasks(roots, 'status', 'desc');
    expect(sections.map((s) => [s.value, ids(s.tasks)])).toEqual([['in_progress', [10]], ['todo', [14]]]);
    expect(ids(childrenByEpic.get(10))).toEqual([20, 11]);
  });
});

describe('nestEpicChildren — Done tab', () => {
  const epic = makeTask({ id: 30, type: 'epic', status: 'in_progress', priority: 'high', scope: 'example-scope' });
  const openChild = makeTask({ id: 31, parentId: 30, priority: 'critical', type: 'feature', scope: 'example-scope' });
  const doneBug = makeTask({ id: 32, parentId: 30, status: 'done', priority: 'medium', type: 'bug', scope: 'example-scope' });
  const doneFeature = makeTask({ id: 33, parentId: 30, status: 'done', priority: 'low', type: 'feature', scope: 'example-scope' });
  const lonelyEpic = makeTask({ id: 34, type: 'epic', status: 'todo' });
  const lonelyChild = makeTask({ id: 35, parentId: 34 });
  const plainDone = makeTask({ id: 36, status: 'done', priority: 'critical', type: 'tool', scope: 'other-scope' });
  const doneEpic = makeTask({ id: 40, type: 'epic', status: 'done', scope: 'other-scope' });
  const doneEpicChild = makeTask({ id: 41, parentId: 40, status: 'done', scope: 'other-scope' });
  const active = [epic, openChild, lonelyEpic, lonelyChild];
  const done = [doneBug, doneFeature, plainDone, doneEpic, doneEpicChild];
  const ids = (ts: Task[] | undefined) => (ts ?? []).map((t) => t.id);

  it('pulls in an open epic with a done child, with all its children by the current sort', () => {
    const { roots, childrenByEpic, anchors } = nestEpicChildren(done, active, 'priority', 'desc');
    expect(ids(roots)).toEqual([36, 30, 40]);
    expect(ids(childrenByEpic.get(30))).toEqual([31, 32, 33]);
    expect(childrenByEpic.has(34)).toBe(false);
    expect(anchors.get(30)?.id).toBe(32);
  });

  it('keeps a done epic unchanged', () => {
    const { childrenByEpic, anchors } = nestEpicChildren(done, active, 'priority', 'desc');
    expect(ids(childrenByEpic.get(40))).toEqual([41]);
    expect(anchors.has(40)).toBe(false);
  });

  it('Group by = status: the pulled-in block sits in Done and no other status group appears', () => {
    const tree = nestEpicChildren(done, active, 'priority', 'desc');
    const sections = groupTasks(tree.roots, 'status', 'desc', tree.anchors);
    expect(sections.map((s) => [s.value, ids(s.tasks)])).toEqual([['done', [36, 30, 40]]]);
  });

  it('Group by = scope / none: the block sits with its done children', () => {
    const tree = nestEpicChildren(done, active, 'priority', 'desc');
    const byScope = groupTasks(tree.roots, 'scope', 'asc', tree.anchors);
    expect(byScope.map((s) => [s.value, ids(s.tasks)])).toEqual([['example-scope', [30]], ['other-scope', [36, 40]]]);
    expect(ids(groupTasks(tree.roots, 'none', 'asc', tree.anchors)[0]?.tasks)).toEqual([36, 30, 40]);
  });

  it('Group by = type: done children that disagree put the block with the first done child by sort', () => {
    const desc = nestEpicChildren(done, active, 'priority', 'desc');
    expect(groupTasks(desc.roots, 'type', 'desc', desc.anchors).find((s) => ids(s.tasks).includes(30))?.value).toBe('bug');
    const asc = nestEpicChildren(done, active, 'priority', 'asc');
    expect(groupTasks(asc.roots, 'type', 'desc', asc.anchors).find((s) => ids(s.tasks).includes(30))?.value).toBe('feature');
  });

  it('section badges count only done tasks', () => {
    const tree = nestEpicChildren(done, active, 'priority', 'desc');
    const doneIds = new Set(done.map((t) => t.id));
    expect(countOwnTasks(tree.roots, tree.childrenByEpic, doneIds)).toBe(done.length);
    const byScope = groupTasks(tree.roots, 'scope', 'asc', tree.anchors);
    expect(byScope.map((s) => countOwnTasks(s.tasks, tree.childrenByEpic, doneIds))).toEqual([2, 3]);
  });
});

describe('countOwnTasks', () => {
  it('counts own roots and own children, not ones pulled in from the other tab', () => {
    const epic = makeTask({ id: 10, type: 'epic' });
    const own = [epic, makeTask({ id: 11, parentId: 10 }), makeTask({ id: 12 })];
    const done = [makeTask({ id: 13, parentId: 10, status: 'done' }), makeTask({ id: 14, parentId: 10, status: 'done' })];
    const { roots, childrenByEpic } = nestEpicChildren(own, done, 'priority', 'desc');
    expect(countOwnTasks(roots, childrenByEpic, new Set(own.map((t) => t.id)))).toBe(3);
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

describe('defaultView', () => {
  const open: TaskStatus[] = ['refinement', 'plan', 'todo', 'in_progress'];

  it.each(open)('active tab: %s is collapsed', (status) => {
    expect(defaultView(status, 'active')).toBe('collapsed');
  });

  it('active tab: done is compact', () => {
    expect(defaultView('done', 'active')).toBe('compact');
  });

  it.each(open)('done tab: %s is compact', (status) => {
    expect(defaultView(status, 'done')).toBe('compact');
  });

  it('done tab: done is collapsed', () => {
    expect(defaultView('done', 'done')).toBe('collapsed');
  });
});

describe('nextView', () => {
  it('cycles compact -> collapsed -> full -> compact', () => {
    expect(nextView('compact')).toBe('collapsed');
    expect(nextView('collapsed')).toBe('full');
    expect(nextView('full')).toBe('compact');
  });

  it('returns to the start after three steps from any view', () => {
    for (const v of ['compact', 'collapsed', 'full'] as CardView[]) {
      expect(nextView(nextView(nextView(v)))).toBe(v);
    }
  });
});

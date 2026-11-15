import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePosition, type Sibling } from './epicPosition.js';

const EPIC = 1;
const kid = (id: number, status: string, seq: number | null): Sibling => ({ id, status, seq });

describe('resolvePosition', () => {
  test("'next' lands in the gap between the last started and the first not-started child", () => {
    const r = resolvePosition([kid(2, 'done', 80), kid(3, 'plan', 90)], 'next', EPIC);
    assert.deepEqual(r, { seq: 85, renumbered: [] });
  });

  test("'next' with no free integer renumbers the epic, then takes the midpoint", () => {
    const r = resolvePosition([kid(2, 'done', 80), kid(3, 'todo', 81), kid(4, 'todo', null)], 'next', EPIC);
    assert.deepEqual(r, { seq: 15, renumbered: [{ id: 2, from: 80, to: 10 }, { id: 3, from: 81, to: 20 }] });
  });

  test("'next' with no not-started sequenced child acts as 'last'", () => {
    assert.equal(resolvePosition([kid(2, 'done', 10), kid(3, 'in_progress', 20)], 'next', EPIC).seq, 30);
    assert.equal(resolvePosition([kid(2, 'done', 10), kid(3, 'todo', null)], 'next', EPIC).seq, 20);
  });

  test("'next' before the first child when nothing has started", () => {
    assert.deepEqual(resolvePosition([kid(2, 'todo', 10)], 'next', EPIC), { seq: 5, renumbered: [] });
  });

  test("'next' and 'last' on an empty epic give 10", () => {
    assert.equal(resolvePosition([], 'next', EPIC).seq, 10);
    assert.equal(resolvePosition([], 'last', EPIC).seq, 10);
  });

  test("'last' goes after the highest seq, ignoring unset children", () => {
    assert.equal(resolvePosition([kid(2, 'todo', 30), kid(3, 'todo', null), kid(4, 'done', 10)], 'last', EPIC).seq, 40);
  });

  test('after / before a parallel group never joins it', () => {
    const kids = [kid(2, 'todo', 10), kid(3, 'todo', 20), kid(4, 'todo', 20), kid(5, 'todo', 30)];
    assert.equal(resolvePosition(kids, { after: 3 }, EPIC).seq, 25);
    assert.equal(resolvePosition(kids, { after: 4 }, EPIC).seq, 25);
    assert.equal(resolvePosition(kids, { before: 4 }, EPIC).seq, 15);
    assert.equal(resolvePosition(kids, { after: 5 }, EPIC).seq, 40);
    assert.equal(resolvePosition(kids, { before: 2 }, EPIC).seq, 5);
  });

  test('before the first child at seq 1 renumbers', () => {
    const r = resolvePosition([kid(2, 'todo', 1)], { before: 2 }, EPIC);
    assert.deepEqual(r, { seq: 5, renumbered: [{ id: 2, from: 1, to: 10 }] });
  });

  test('a renumber keeps parallel groups together and leaves unset children unset', () => {
    const kids = [kid(2, 'todo', 10), kid(3, 'todo', 11), kid(4, 'todo', 11), kid(5, 'todo', null)];
    const r = resolvePosition(kids, { before: 3 }, EPIC);
    assert.deepEqual(r, { seq: 15, renumbered: [{ id: 3, from: 11, to: 20 }, { id: 4, from: 11, to: 20 }] });
  });

  test("before an unset child acts as 'last'", () => {
    assert.equal(resolvePosition([kid(2, 'todo', 10), kid(3, 'todo', null)], { before: 3 }, EPIC).seq, 20);
  });

  test('after an unset child is an error', () => {
    assert.throws(() => resolvePosition([kid(3, 'todo', null)], { after: 3 }, EPIC), /#3 has no seq/);
  });

  test('a non-sibling id is an error', () => {
    assert.throws(() => resolvePosition([kid(2, 'todo', 10)], { after: 9 }, EPIC), /#9 is not a child of epic #1/);
    assert.throws(() => resolvePosition([], { before: 9 }, EPIC), /#9 is not a child of epic #1/);
  });

  test('a malformed position is an error', () => {
    assert.throws(() => resolvePosition([], {} as never, EPIC), /position must be 'next', 'last'/);
    assert.throws(() => resolvePosition([], 'first' as never, EPIC), /position must be 'next', 'last'/);
  });
});

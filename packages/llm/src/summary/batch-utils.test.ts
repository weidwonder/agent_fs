import { describe, expect, it } from 'vitest';
import { groupByTokenBudget } from './batch-utils';

describe('groupByTokenBudget', () => {
  it('splits when next item would exceed budget', () => {
    const items = [
      { id: 'a', tokens: 4, payload: 'a' },
      { id: 'b', tokens: 4, payload: 'b' },
      { id: 'c', tokens: 4, payload: 'c' },
    ];

    const batches = groupByTokenBudget(items, 8);
    expect(batches.map((batch) => batch.map((item) => item.id))).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
  });

  it('keeps oversized item as a single batch', () => {
    const items = [
      { id: 'a', tokens: 12, payload: 'a' },
      { id: 'b', tokens: 3, payload: 'b' },
    ];

    const batches = groupByTokenBudget(items, 10);
    expect(batches.map((batch) => batch.map((item) => item.id))).toEqual([
      ['a'],
      ['b'],
    ]);
  });
});

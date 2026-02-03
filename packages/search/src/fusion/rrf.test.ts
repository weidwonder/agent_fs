import { describe, it, expect } from 'vitest';
import { rrfScore, fusionRRF } from './rrf';

describe('rrfScore', () => {
  it('should compute score with default k', () => {
    expect(rrfScore(1)).toBeCloseTo(1 / 61, 10);
  });

  it('should compute score with custom k', () => {
    expect(rrfScore(1, 10)).toBeCloseTo(1 / 11, 10);
  });
});

describe('fusionRRF', () => {
  it('should keep order for single list', () => {
    const list = [
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
    ];

    const fused = fusionRRF(
      [{ name: 'list1', items: list }],
      (item) => item.id
    );

    expect(fused.length).toBe(2);
    expect(fused[0].item.id).toBe('a');
    expect(fused[1].item.id).toBe('b');
  });

  it('should accumulate scores and sources for duplicates', () => {
    const list1 = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
    const list2 = [{ id: 'a', value: 3 }, { id: 'c', value: 4 }];

    const fused = fusionRRF(
      [
        { name: 'list1', items: list1 },
        { name: 'list2', items: list2 },
      ],
      (item) => item.id
    );

    const itemA = fused.find((item) => item.item.id === 'a');
    expect(itemA).toBeDefined();
    expect(itemA?.sources.sort()).toEqual(['list1', 'list2']);

    const expectedScore = rrfScore(1) + rrfScore(1);
    expect(itemA?.score).toBeCloseTo(expectedScore, 10);
  });

  it('should merge items when merge function is provided', () => {
    const list1 = [{ id: 'x', value: 1, extra: '' }];
    const list2 = [{ id: 'x', value: 2, extra: 'from-list2' }];

    let mergeCalls = 0;
    const fused = fusionRRF(
      [
        { name: 'list1', items: list1 },
        { name: 'list2', items: list2 },
      ],
      (item) => item.id,
      (existing, newItem) => {
        mergeCalls += 1;
        return {
          ...existing,
          extra: existing.extra || newItem.extra,
        };
      }
    );

    expect(mergeCalls).toBe(1);
    expect(fused[0].item.extra).toBe('from-list2');
  });

  it('should handle empty lists', () => {
    const fused = fusionRRF<{ id: string }>([], (item) => item.id);
    expect(fused).toEqual([]);
  });

  it('should handle multiple lists with unique items', () => {
    const fused = fusionRRF(
      [
        { name: 'l1', items: [{ id: 'a', value: 1 }] },
        { name: 'l2', items: [{ id: 'b', value: 2 }] },
        { name: 'l3', items: [{ id: 'c', value: 3 }] },
      ],
      (item) => item.id
    );

    const ids = fused.map((item) => item.item.id).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
  });
});

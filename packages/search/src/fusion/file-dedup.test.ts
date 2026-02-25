import { describe, expect, it } from 'vitest';
import { aggregateTopByFile } from './file-dedup';
import type { FusedItem } from './rrf';

interface MockItem {
  chunkId: string;
  filePath?: string;
}

function fused(item: MockItem, score: number): FusedItem<MockItem> {
  return {
    item,
    score,
    sources: ['mock'],
  };
}

describe('aggregateTopByFile', () => {
  it('应聚合同文件并提升分数', () => {
    const input: FusedItem<MockItem>[] = [
      fused({ chunkId: 'f1:0000', filePath: '/a.md' }, 0.9),
      fused({ chunkId: 'f1:0001', filePath: '/a.md' }, 0.8),
      fused({ chunkId: 'f2:0000', filePath: '/b.md' }, 0.85),
    ];

    const result = aggregateTopByFile(
      input,
      2,
      (item) => item.filePath,
      (item) => item.chunkId,
      { scoreBoostFactor: 0.5 }
    );

    expect(result).toHaveLength(2);
    expect(result[0].item.chunkId).toBe('f1:0000');
    expect(result[0].chunkHits).toBe(2);
    expect(result[0].chunkIds).toEqual(['f1:0000', 'f1:0001']);
    expect(result[0].score).toBeCloseTo(1.3, 10);
  });

  it('scoreBoostFactor=0 时应等价于文件级代表项分数', () => {
    const input: FusedItem<MockItem>[] = [
      fused({ chunkId: 'f1:0000', filePath: '/a.md' }, 0.9),
      fused({ chunkId: 'f1:0001', filePath: '/a.md' }, 0.8),
      fused({ chunkId: 'f2:0000', filePath: '/b.md' }, 0.85),
    ];

    const result = aggregateTopByFile(
      input,
      2,
      (item) => item.filePath,
      (item) => item.chunkId,
      { scoreBoostFactor: 0 }
    );

    expect(result[0].score).toBeCloseTo(0.9, 10);
  });

  it('topK 小于等于 0 时返回空数组', () => {
    const input: FusedItem<MockItem>[] = [fused({ chunkId: 'f1:0000', filePath: '/a.md' }, 0.95)];
    expect(
      aggregateTopByFile(input, 0, (item) => item.filePath, (item) => item.chunkId)
    ).toEqual([]);
    expect(
      aggregateTopByFile(input, -1, (item) => item.filePath, (item) => item.chunkId)
    ).toEqual([]);
  });
});

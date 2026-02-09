import { describe, expect, it } from 'vitest';
import { computeMetrics, filterScoredChunks } from './retrieval-eval-core';

describe('retrieval-eval-core', () => {
  it('应按最小分数过滤向量结果', () => {
    const filtered = filterScoredChunks(
      [
        { chunkId: 'a', score: 0.9 },
        { chunkId: 'b', score: 0.59 },
        { chunkId: 'c', score: 0.61 },
      ],
      0.6
    );

    expect(filtered.map((item) => item.chunkId)).toEqual(['a', 'c']);
  });

  it('应计算 Precision@K 与 Precision@Returned', () => {
    const metrics = computeMetrics(['chunk-1'], ['chunk-1'], 10);

    expect(metrics.precisionAtK).toBe(0.1);
    expect(metrics.precisionAtReturned).toBe(1);
    expect(metrics.returnedCount).toBe(1);
    expect(metrics.recallAtK).toBe(1);
  });
});

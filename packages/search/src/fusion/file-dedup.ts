import type { FusedItem } from './rrf';

export interface FileAggregationOptions {
  /**
   * 同文件多 chunk 命中时的分数提升系数。
   * 0 表示不提升，1 表示把同文件分数完全累加。
   */
  scoreBoostFactor?: number;
}

export interface FileAggregatedItem<T> extends FusedItem<T> {
  chunkHits: number;
  chunkIds: string[];
}

/**
 * 按文件聚合 RRF 结果：
 * - 每个文件只保留一个代表项（默认选择同文件内分数最高的 chunk）
 * - 同文件多 chunk 命中会对代表项做分数提升
 */
export function aggregateTopByFile<T>(
  fused: FusedItem<T>[],
  topK: number,
  getFileKey: (item: T) => string | null | undefined,
  getChunkId: (item: T) => string,
  options: FileAggregationOptions = {},
): FileAggregatedItem<T>[] {
  if (topK <= 0) {
    return [];
  }

  const scoreBoostFactor = normalizeBoostFactor(options.scoreBoostFactor);

  const groups = new Map<
    string,
    {
      representative: FusedItem<T>;
      scoreSum: number;
      chunkIds: string[];
      chunkIdSet: Set<string>;
      sources: Set<string>;
    }
  >();

  for (const row of fused) {
    const rawFileKey = getFileKey(row.item);
    const fileKey = normalizeFileKey(rawFileKey, getChunkId(row.item));
    const chunkId = getChunkId(row.item);

    const group = groups.get(fileKey);
    if (!group) {
      groups.set(fileKey, {
        representative: row,
        scoreSum: row.score,
        chunkIds: chunkId ? [chunkId] : [],
        chunkIdSet: new Set(chunkId ? [chunkId] : []),
        sources: new Set(row.sources),
      });
      continue;
    }

    group.scoreSum += row.score;
    if (chunkId && !group.chunkIdSet.has(chunkId)) {
      group.chunkIdSet.add(chunkId);
      group.chunkIds.push(chunkId);
    }
    for (const source of row.sources) {
      group.sources.add(source);
    }

    if (row.score > group.representative.score) {
      group.representative = row;
    }
  }

  const aggregated: FileAggregatedItem<T>[] = [...groups.values()].map((group) => {
    const representativeScore = group.representative.score;
    const extraScore = Math.max(0, group.scoreSum - representativeScore);
    const boostedScore = representativeScore + extraScore * scoreBoostFactor;

    return {
      item: group.representative.item,
      score: boostedScore,
      sources: [...group.sources],
      chunkHits: group.chunkIds.length,
      chunkIds: [...group.chunkIds],
    };
  });

  aggregated.sort((left, right) => right.score - left.score);
  return aggregated.slice(0, topK);
}

function normalizeBoostFactor(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0.35;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function normalizeFileKey(value: string | null | undefined, fallbackChunkId: string): string {
  const fileKey = typeof value === 'string' ? value.trim() : '';
  if (fileKey) {
    return fileKey;
  }
  return `__chunk__:${fallbackChunkId}`;
}

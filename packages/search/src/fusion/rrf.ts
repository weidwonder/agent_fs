/**
 * RRF（Reciprocal Rank Fusion）参数
 */
export interface RRFParams {
  /** k 参数，默认 60 */
  k: number;
}

export const DEFAULT_RRF_PARAMS: RRFParams = {
  k: 60,
};

/**
 * 搜索结果项
 */
export interface RankedItem<T> {
  item: T;
  rank: number;
}

/**
 * 融合结果项
 */
export interface FusedItem<T> {
  item: T;
  score: number;
  sources: string[];
}

/**
 * 计算 RRF 分数
 * score = 1 / (k + rank)
 */
export function rrfScore(rank: number, k: number = DEFAULT_RRF_PARAMS.k): number {
  return 1 / (k + rank);
}

/**
 * 使用 RRF 融合多个排名列表
 * @param lists 多个排名列表，每个列表按相关度降序排列
 * @param getId 获取项目唯一标识的函数
 * @param merge 合并同一项目的多个版本（可选，用于补充缺失字段）
 * @param params RRF 参数
 */
export function fusionRRF<T>(
  lists: { name: string; items: T[] }[],
  getId: (item: T) => string,
  merge?: (existing: T, newItem: T, source: string) => T,
  params: RRFParams = DEFAULT_RRF_PARAMS
): FusedItem<T>[] {
  const scoreMap = new Map<string, { item: T; score: number; sources: string[] }>();

  for (const list of lists) {
    for (let rank = 0; rank < list.items.length; rank++) {
      const item = list.items[rank];
      const id = getId(item);
      const score = rrfScore(rank + 1, params.k);

      const existing = scoreMap.get(id);
      if (existing) {
        existing.score += score;
        existing.sources.push(list.name);
        if (merge) {
          existing.item = merge(existing.item, item, list.name);
        }
      } else {
        scoreMap.set(id, {
          item,
          score,
          sources: [list.name],
        });
      }
    }
  }

  return Array.from(scoreMap.values()).sort((a, b) => b.score - a.score);
}

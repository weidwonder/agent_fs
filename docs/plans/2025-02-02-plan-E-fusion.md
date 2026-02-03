# [E] Fusion - 多路召回融合实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 RRF 多路召回融合，合并向量搜索和 BM25 结果

**Architecture:** RRF 算法实现，支持可配置的权重和 k 参数

**Tech Stack:** TypeScript

**依赖:** [B3] bm25, [D] vector-store

**被依赖:** [F] indexer, [G1] mcp-server

---

## 成功标准

- [ ] RRF 算法正确实现
- [ ] 能融合向量搜索和 BM25 结果
- [ ] 融合结果按分数排序
- [ ] 单元测试覆盖率 > 80%

---

## 重要说明

### 字段命名约定

- **内部存储**（`VectorDocument`, `BM25Document`）使用 **snake_case**
- **外部 API**（`SearchResult`）使用 **camelCase**

从存储读取时使用 snake_case，输出到 API 时映射为 camelCase。

---

## Task 1: 创建 fusion 模块

**Files:**
- Create: `packages/search/src/fusion/index.ts`
- Create: `packages/search/src/fusion/rrf.ts`
- Create: `packages/search/src/fusion/search-fusion.ts`

**Step 1: 创建目录**

Run: `mkdir -p packages/search/src/fusion`

---

## Task 2: 实现 RRF 算法

**Files:**
- Modify: `packages/search/src/fusion/rrf.ts`

```typescript
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
 * @param params RRF 参数
 */
export function fusionRRF<T>(
  lists: { name: string; items: T[] }[],
  getId: (item: T) => string,
  params: RRFParams = DEFAULT_RRF_PARAMS
): FusedItem<T>[] {
  // 累积每个项目的 RRF 分数
  const scoreMap = new Map<string, { item: T; score: number; sources: string[] }>();

  for (const list of lists) {
    for (let rank = 0; rank < list.items.length; rank++) {
      const item = list.items[rank];
      const id = getId(item);
      const score = rrfScore(rank + 1, params.k); // rank 从 1 开始

      const existing = scoreMap.get(id);
      if (existing) {
        existing.score += score;
        existing.sources.push(list.name);
      } else {
        scoreMap.set(id, {
          item,
          score,
          sources: [list.name],
        });
      }
    }
  }

  // 按分数降序排序
  const results = Array.from(scoreMap.values()).sort((a, b) => b.score - a.score);

  return results;
}
```

---

## Task 3: 实现 SearchFusion

**Files:**
- Modify: `packages/search/src/fusion/search-fusion.ts`

```typescript
import type { SearchResult, SearchOptions, SearchResponse } from '@agent-fs/core';
import type { VectorStore } from '../vector-store';
import type { BM25Index } from '../bm25';
import { fusionRRF, type RRFParams, DEFAULT_RRF_PARAMS } from './rrf';
import type { EmbeddingService } from '@agent-fs/llm';

export interface FusionOptions {
  /** RRF 参数 */
  rrfParams?: RRFParams;

  /** 是否使用内容向量搜索 */
  useContentVector?: boolean;

  /** 是否使用摘要向量搜索 */
  useSummaryVector?: boolean;

  /** 是否使用 BM25 */
  useBM25?: boolean;
}

export class SearchFusion {
  private vectorStore: VectorStore;
  private bm25Index: BM25Index;
  private embeddingService: EmbeddingService;

  constructor(
    vectorStore: VectorStore,
    bm25Index: BM25Index,
    embeddingService: EmbeddingService
  ) {
    this.vectorStore = vectorStore;
    this.bm25Index = bm25Index;
    this.embeddingService = embeddingService;
  }

  async search(options: SearchOptions, fusionOptions: FusionOptions = {}): Promise<SearchResponse> {
    const {
      rrfParams = DEFAULT_RRF_PARAMS,
      useContentVector = true,
      useSummaryVector = true,
      useBM25 = true,
    } = fusionOptions;

    const startTime = Date.now();
    const { query, keyword, scope, topK = 10 } = options;

    // 准备搜索参数
    const scopes = Array.isArray(scope) ? scope : [scope];
    const filePathPrefix = scopes[0]; // 简化：使用第一个 scope

    // 收集多路召回结果
    const lists: { name: string; items: SearchResult[] }[] = [];

    // 1. 内容向量搜索
    if (useContentVector) {
      const queryVector = await this.embeddingService.embed(query);
      const results = await this.vectorStore.searchByContent(queryVector, {
        topK: topK * 2,
        filePathPrefix,
      });

      // 从 snake_case 存储格式映射到 camelCase API 格式
      lists.push({
        name: 'content_vector',
        items: results.map((r) => ({
          chunkId: r.chunk_id,
          score: r.score,
          content: r.document.content,
          summary: r.document.summary,
          source: {
            filePath: r.document.file_path,
            locator: r.document.locator,
          },
        })),
      });
    }

    // 2. 摘要向量搜索
    if (useSummaryVector) {
      const queryVector = await this.embeddingService.embed(query);
      const results = await this.vectorStore.searchBySummary(queryVector, {
        topK: topK * 2,
        filePathPrefix,
      });

      lists.push({
        name: 'summary_vector',
        items: results.map((r) => ({
          chunkId: r.chunk_id,
          score: r.score,
          content: r.document.content,
          summary: r.document.summary,
          source: {
            filePath: r.document.file_path,
            locator: r.document.locator,
          },
        })),
      });
    }

    // 3. BM25 搜索
    if (useBM25) {
      const searchQuery = keyword || query;
      const results = this.bm25Index.search(searchQuery, {
        topK: topK * 2,
        filePathPrefix,
      });

      lists.push({
        name: 'bm25',
        items: results.map((r) => ({
          chunkId: r.chunk_id,
          score: r.score,
          content: r.document.content,
          summary: '', // BM25 文档没有 summary
          source: {
            filePath: r.document.file_path,
            locator: '', // 需要从其他地方获取
          },
        })),
      });
    }

    // RRF 融合
    const fused = fusionRRF(lists, (item) => item.chunkId, rrfParams);

    // 取 top-k
    const results = fused.slice(0, topK).map((f) => ({
      ...f.item,
      score: f.score,
    }));

    return {
      results,
      meta: {
        totalSearched: lists.reduce((sum, l) => sum + l.items.length, 0),
        fusionMethod: 'rrf',
        elapsedMs: Date.now() - startTime,
      },
    };
  }
}

export function createSearchFusion(
  vectorStore: VectorStore,
  bm25Index: BM25Index,
  embeddingService: EmbeddingService
): SearchFusion {
  return new SearchFusion(vectorStore, bm25Index, embeddingService);
}
```

---

## Task 4: 更新导出

```typescript
// packages/search/src/fusion/index.ts
export { fusionRRF, rrfScore, DEFAULT_RRF_PARAMS } from './rrf';
export type { RRFParams, RankedItem, FusedItem } from './rrf';
export { SearchFusion, createSearchFusion } from './search-fusion';
export type { FusionOptions } from './search-fusion';

// packages/search/src/index.ts 添加：
export { SearchFusion, createSearchFusion, fusionRRF } from './fusion';
export type { FusionOptions, RRFParams } from './fusion';
```

---

## Task 5: 编写测试

测试 RRF 算法和 SearchFusion。

---

## 完成检查清单

- [ ] RRF 算法实现
- [ ] 多路向量召回
- [ ] BM25 结果融合
- [ ] 正确排序
- [ ] snake_case → camelCase 映射

---

## 输出接口

```typescript
import { SearchFusion, createSearchFusion } from '@agent-fs/search';

const fusion = createSearchFusion(vectorStore, bm25Index, embeddingService);

const response = await fusion.search({
  query: '项目预算',
  scope: '/path/to/project',
  topK: 10,
});

console.log(response.results);
console.log(response.meta.elapsedMs);
```

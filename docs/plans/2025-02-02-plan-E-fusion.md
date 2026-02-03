# [E] Fusion - 多路召回融合实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 RRF 多路召回融合，合并向量搜索和 BM25 结果

**Architecture:** RRF 算法实现，支持可配置的权重和 k 参数

**Tech Stack:** TypeScript

**依赖:** [B3] bm25, [D] vector-store, [C1] embedding

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

### BM25Document 与 VectorDocument 的差异

| 字段 | VectorDocument | BM25Document | 说明 |
|------|----------------|--------------|------|
| summary | ✓ | ✗ | BM25 不存储摘要 |
| locator | ✓ | ✗ | BM25 不存储定位符 |
| content_vector | ✓ | ✗ | BM25 不需要向量 |
| summary_vector | ✓ | ✗ | BM25 不需要向量 |
| tokens | ✗ | ✓ | BM25 存储分词结果 |

**融合策略：** 当 BM25 结果被选中时，如果需要 summary/locator，通过 chunk_id 从 VectorStore 补充获取。RRF 融合会优先使用包含完整信息的 VectorDocument 版本。

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
- Create: `packages/search/src/fusion/rrf.ts`

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
 * @param merge 合并同一项目的多个版本（可选，用于补充缺失字段）
 * @param params RRF 参数
 */
export function fusionRRF<T>(
  lists: { name: string; items: T[] }[],
  getId: (item: T) => string,
  merge?: (existing: T, newItem: T, source: string) => T,
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
        // 合并项目（用于补充缺失字段）
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

  // 按分数降序排序
  const results = Array.from(scoreMap.values()).sort((a, b) => b.score - a.score);

  return results;
}
```

---

## Task 3: 实现 SearchFusion

**Files:**
- Create: `packages/search/src/fusion/search-fusion.ts`

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

    // 缓存查询向量（避免重复计算）
    let queryVector: number[] | null = null;
    if (useContentVector || useSummaryVector) {
      queryVector = await this.embeddingService.embed(query);
    }

    // 1. 内容向量搜索
    if (useContentVector && queryVector) {
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
    if (useSummaryVector && queryVector) {
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

      // BM25Document 没有 summary 和 locator 字段
      // 这些字段会在 RRF 融合时从 VectorDocument 版本补充
      lists.push({
        name: 'bm25',
        items: results.map((r) => ({
          chunkId: r.chunk_id,
          score: r.score,
          content: r.document.content,
          summary: '', // BM25 文档没有 summary，融合时会被覆盖
          source: {
            filePath: r.document.file_path,
            locator: '', // BM25 文档没有 locator，融合时会被覆盖
          },
        })),
      });
    }

    // RRF 融合（带字段合并）
    const fused = fusionRRF(
      lists,
      (item) => item.chunkId,
      // 合并函数：优先使用有 summary/locator 的版本
      (existing, newItem, _source) => {
        return {
          ...existing,
          summary: existing.summary || newItem.summary,
          source: {
            filePath: existing.source.filePath,
            locator: existing.source.locator || newItem.source.locator,
          },
        };
      },
      rrfParams
    );

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

**File:** `packages/search/src/fusion/index.ts`

```typescript
export { fusionRRF, rrfScore, DEFAULT_RRF_PARAMS } from './rrf';
export type { RRFParams, RankedItem, FusedItem } from './rrf';
export { SearchFusion, createSearchFusion } from './search-fusion';
export type { FusionOptions } from './search-fusion';
```

**Update:** `packages/search/src/index.ts` 添加：

```typescript
// Fusion
export { SearchFusion, createSearchFusion, fusionRRF, rrfScore, DEFAULT_RRF_PARAMS } from './fusion';
export type { FusionOptions, RRFParams, RankedItem, FusedItem } from './fusion';
```

---

## Task 5: 编写测试

**Files:**
- Create: `packages/search/src/fusion/rrf.test.ts`
- Create: `packages/search/src/fusion/search-fusion.test.ts`

### 5.1 RRF 算法测试

**测试用例：**

- [ ] `rrfScore` 计算正确（rank=1, k=60 → 1/61）
- [ ] 单列表融合（结果顺序不变）
- [ ] 双列表融合（同一项目分数累加）
- [ ] 多列表融合（3+ 列表）
- [ ] 相同项目的 sources 正确记录
- [ ] merge 函数正确调用（字段补充）
- [ ] 空列表处理
- [ ] 自定义 k 参数

### 5.2 SearchFusion 集成测试

**测试用例：**

- [ ] 仅使用 contentVector 搜索
- [ ] 仅使用 summaryVector 搜索
- [ ] 仅使用 BM25 搜索
- [ ] 三路融合搜索
- [ ] scope 过滤生效
- [ ] topK 限制生效
- [ ] keyword 参数优先用于 BM25
- [ ] 查询向量只计算一次（mock 验证）
- [ ] BM25 结果的 summary/locator 被向量结果补充
- [ ] meta 信息正确（totalSearched, elapsedMs）

---

## 完成检查清单

- [ ] RRF 算法实现
- [ ] 多路向量召回
- [ ] BM25 结果融合
- [ ] 正确排序
- [ ] snake_case → camelCase 映射
- [ ] 查询向量缓存（避免重复计算）
- [ ] 字段合并（BM25 缺失字段补充）
- [ ] 单元测试 > 80% 覆盖率

---

## 输出接口

```typescript
import { SearchFusion, createSearchFusion } from '@agent-fs/search';
import type { EmbeddingService } from '@agent-fs/llm';
import type { VectorStore, BM25Index } from '@agent-fs/search';

const fusion = createSearchFusion(vectorStore, bm25Index, embeddingService);

const response = await fusion.search({
  query: '项目预算',
  scope: '/path/to/project',
  topK: 10,
});

console.log(response.results);
// [
//   {
//     chunkId: 'chunk-001',
//     score: 0.032,  // RRF 分数
//     content: '...',
//     summary: '...',
//     source: { filePath: '...', locator: '...' }
//   },
//   ...
// ]

console.log(response.meta);
// { totalSearched: 60, fusionMethod: 'rrf', elapsedMs: 123 }
```

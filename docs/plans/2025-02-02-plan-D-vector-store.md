# [D] Vector Store - 向量存储实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现基于 LanceDB 的向量存储服务，支持集中存储和 scope 过滤

**Architecture:** LanceDB 封装，集中存储在 ~/.agent_fs/storage/vectors/

**Tech Stack:** LanceDB, vectordb

**依赖:** [A] foundation, [C1] embedding

**被依赖:** [E] fusion, [F] indexer

---

## 成功标准

- [ ] 能存储向量到 LanceDB
- [ ] 能按 scope（dir_id/file_path）过滤查询
- [ ] 支持软删除（deleted_at）
- [ ] 支持批量操作
- [ ] 单元测试覆盖率 > 80%

---

## Task 1: 创建 vector-store 模块

**Files:**
- Create: `packages/search/src/vector-store/index.ts`
- Create: `packages/search/src/vector-store/store.ts`

**Step 1: 创建目录**

Run: `mkdir -p packages/search/src/vector-store`

**Step 2: 安装 LanceDB**

Run: `pnpm add -w vectordb`

---

## Task 2: 实现 VectorStore

**Files:**
- Modify: `packages/search/src/vector-store/store.ts`

```typescript
import * as lancedb from 'vectordb';
import type { VectorDocument, VectorSearchResult } from '@agent-fs/core';

export interface VectorStoreOptions {
  /** 存储目录 */
  storagePath: string;

  /** 向量维度 */
  dimension: number;
}

export interface VectorSearchOptions {
  /** 返回数量 */
  topK?: number;

  /** 目录 ID 过滤 */
  dirId?: string;

  /** 文件路径前缀过滤 */
  filePathPrefix?: string;

  /** 是否包含已删除 */
  includeDeleted?: boolean;
}

export class VectorStore {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private options: VectorStoreOptions;

  constructor(options: VectorStoreOptions) {
    this.options = options;
  }

  async init(): Promise<void> {
    this.db = await lancedb.connect(this.options.storagePath);

    // 检查表是否存在，不存在则创建
    const tables = await this.db.tableNames();
    if (tables.includes('chunks')) {
      this.table = await this.db.openTable('chunks');
    }
  }

  private async ensureTable(): Promise<lancedb.Table> {
    if (!this.db) throw new Error('Database not initialized');

    if (!this.table) {
      // 创建空表（使用 schema）
      this.table = await this.db.createTable('chunks', [
        {
          chunkId: '',
          fileId: '',
          dirId: '',
          filePath: '',
          content: '',
          summary: '',
          contentVector: new Array(this.options.dimension).fill(0),
          summaryVector: new Array(this.options.dimension).fill(0),
          locator: '',
          indexedAt: '',
          deletedAt: null,
        },
      ]);
    }

    return this.table;
  }

  async addDocuments(docs: VectorDocument[]): Promise<void> {
    const table = await this.ensureTable();
    await table.add(docs);
  }

  async searchByContent(
    vector: number[],
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    const { topK = 10, dirId, filePathPrefix, includeDeleted = false } = options;

    const table = await this.ensureTable();

    let query = table.search(vector).column('contentVector').limit(topK * 2);

    // 构建过滤条件
    const filters: string[] = [];
    if (!includeDeleted) {
      filters.push('deletedAt IS NULL');
    }
    if (dirId) {
      filters.push(`dirId = '${dirId}'`);
    }
    if (filePathPrefix) {
      filters.push(`filePath LIKE '${filePathPrefix}%'`);
    }

    if (filters.length > 0) {
      query = query.filter(filters.join(' AND '));
    }

    const results = await query.execute();

    return results.slice(0, topK).map((row) => ({
      chunkId: row.chunkId,
      score: 1 - (row._distance ?? 0), // LanceDB 返回距离，转换为相似度
      document: row as VectorDocument,
    }));
  }

  async searchBySummary(
    vector: number[],
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    const { topK = 10, dirId, filePathPrefix, includeDeleted = false } = options;

    const table = await this.ensureTable();

    let query = table.search(vector).column('summaryVector').limit(topK * 2);

    const filters: string[] = [];
    if (!includeDeleted) {
      filters.push('deletedAt IS NULL');
    }
    if (dirId) {
      filters.push(`dirId = '${dirId}'`);
    }
    if (filePathPrefix) {
      filters.push(`filePath LIKE '${filePathPrefix}%'`);
    }

    if (filters.length > 0) {
      query = query.filter(filters.join(' AND '));
    }

    const results = await query.execute();

    return results.slice(0, topK).map((row) => ({
      chunkId: row.chunkId,
      score: 1 - (row._distance ?? 0),
      document: row as VectorDocument,
    }));
  }

  async softDelete(chunkIds: string[]): Promise<void> {
    const table = await this.ensureTable();
    const now = new Date().toISOString();

    for (const chunkId of chunkIds) {
      await table.update({
        where: `chunkId = '${chunkId}'`,
        values: { deletedAt: now },
      });
    }
  }

  async deleteByDirId(dirId: string): Promise<void> {
    const table = await this.ensureTable();
    await table.delete(`dirId = '${dirId}'`);
  }

  async deleteByFileId(fileId: string): Promise<void> {
    const table = await this.ensureTable();
    await table.delete(`fileId = '${fileId}'`);
  }

  async updateFilePaths(dirId: string, oldPrefix: string, newPrefix: string): Promise<void> {
    // 用于目录移动/重命名
    const table = await this.ensureTable();
    const rows = await table.filter(`dirId = '${dirId}'`).execute();

    for (const row of rows) {
      if (row.filePath.startsWith(oldPrefix)) {
        await table.update({
          where: `chunkId = '${row.chunkId}'`,
          values: { filePath: row.filePath.replace(oldPrefix, newPrefix) },
        });
      }
    }
  }

  async compact(): Promise<number> {
    const table = await this.ensureTable();
    const beforeCount = await table.countRows();
    await table.delete('deletedAt IS NOT NULL');
    const afterCount = await table.countRows();
    return beforeCount - afterCount;
  }

  async close(): Promise<void> {
    // LanceDB 连接清理
    this.table = null;
    this.db = null;
  }
}

export function createVectorStore(options: VectorStoreOptions): VectorStore {
  return new VectorStore(options);
}
```

---

## Task 3: 更新导出

```typescript
// packages/search/src/vector-store/index.ts
export { VectorStore, createVectorStore } from './store';
export type { VectorStoreOptions, VectorSearchOptions } from './store';

// packages/search/src/index.ts 添加：
export { VectorStore, createVectorStore } from './vector-store';
export type { VectorStoreOptions, VectorSearchOptions } from './vector-store';
```

---

## Task 4: 编写测试

测试向量存储的 CRUD 操作和搜索功能。

---

## 完成检查清单

- [ ] LanceDB 集成
- [ ] 向量搜索（content + summary）
- [ ] scope 过滤
- [ ] 软删除支持
- [ ] 批量操作

---

## 输出接口

```typescript
import { VectorStore, createVectorStore } from '@agent-fs/search';

const store = createVectorStore({
  storagePath: '~/.agent_fs/storage/vectors',
  dimension: 512,
});

await store.init();
await store.addDocuments([...]);

const results = await store.searchByContent(queryVector, {
  topK: 10,
  filePathPrefix: '/path/to/project',
});
```

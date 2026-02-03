# [D] Vector Store - 向量存储实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现基于 LanceDB 的向量存储服务，支持集中存储和 scope 过滤

**Architecture:** LanceDB 封装，集中存储在 ~/.agent_fs/storage/vectors/

**Tech Stack:** @lancedb/lancedb

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

## 重要说明

### LanceDB API 注意事项

通过 spike 测试验证的关键发现：

1. **包名**：使用 `@lancedb/lancedb`（不是旧版 `vectordb`）
2. **列名必须使用 snake_case**：LanceDB 的 SQL 解析器会将列名转为小写
   - ✓ `dir_id`、`chunk_id`、`content_vector`
   - ✗ `dirId`、`chunkId`、`contentVector`（会被转为小写导致找不到）
3. **多向量列必须指定 column()**：当表有多个向量列时
4. **软删除用空字符串**：`deleted_at: ''` 表示未删除（不用 null）
5. **距离转换**：cosine 距离范围 0-2，转相似度用 `score = 1 - (distance / 2)`

### 类型定义

`@agent-fs/core` 中的 `VectorDocument` 已更新为 snake_case 命名：

```typescript
interface VectorDocument {
  chunk_id: string;
  file_id: string;
  dir_id: string;
  rel_path: string;
  file_path: string;
  content: string;
  summary: string;
  content_vector: number[];
  summary_vector: number[];
  locator: string;
  indexed_at: string;
  deleted_at: string;  // 空字符串 = 未删除
}
```

---

## Task 1: 安装 LanceDB

**Step 1: 添加依赖**

```bash
pnpm add @lancedb/lancedb --filter @agent-fs/search
```

注意：平台原生包会自动解析安装。

---

## Task 2: 创建 vector-store 模块

**Files:**
- Create: `packages/search/src/vector-store/index.ts`
- Create: `packages/search/src/vector-store/store.ts`

**Step 1: 创建目录**

```bash
mkdir -p packages/search/src/vector-store
```

---

## Task 3: 实现 VectorStore

**File:** `packages/search/src/vector-store/store.ts`

```typescript
import * as lancedb from '@lancedb/lancedb';
import type { VectorDocument, VectorSearchResult } from '@agent-fs/core';

export interface VectorStoreOptions {
  /** 存储目录 */
  storagePath: string;

  /** 向量维度 */
  dimension: number;

  /** 表名 */
  tableName?: string;
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

  /** 距离类型 */
  distanceType?: 'l2' | 'cosine' | 'dot';
}

export class VectorStore {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private options: Required<VectorStoreOptions>;

  constructor(options: VectorStoreOptions) {
    this.options = {
      tableName: 'chunks',
      ...options,
    };
  }

  async init(): Promise<void> {
    this.db = await lancedb.connect(this.options.storagePath);

    const tables = await this.db.tableNames();
    if (tables.includes(this.options.tableName)) {
      this.table = await this.db.openTable(this.options.tableName);
    }
  }

  private async ensureTable(): Promise<lancedb.Table> {
    if (!this.db) throw new Error('Database not initialized');

    if (!this.table) {
      // 创建空表（使用初始数据定义 schema）
      const emptyDoc: VectorDocument = {
        chunk_id: '',
        file_id: '',
        dir_id: '',
        rel_path: '',
        file_path: '',
        content: '',
        summary: '',
        content_vector: new Array(this.options.dimension).fill(0),
        summary_vector: new Array(this.options.dimension).fill(0),
        locator: '',
        indexed_at: '',
        deleted_at: '',
      };
      this.table = await this.db.createTable(this.options.tableName, [emptyDoc]);
      // 删除占位记录
      await this.table.delete(`chunk_id = ''`);
    }

    return this.table;
  }

  async addDocuments(docs: VectorDocument[]): Promise<void> {
    if (docs.length === 0) return;
    const table = await this.ensureTable();
    await table.add(docs);
  }

  async searchByContent(
    vector: number[],
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    const {
      topK = 10,
      dirId,
      filePathPrefix,
      includeDeleted = false,
      distanceType = 'cosine',
    } = options;

    const table = await this.ensureTable();

    let query = table.vectorSearch(vector)
      .column('content_vector')
      .distanceType(distanceType)
      .limit(topK * 2); // 多取一些，后面过滤后可能不够

    // 构建过滤条件
    const filters: string[] = [];
    if (!includeDeleted) {
      filters.push(`deleted_at = ''`);
    }
    if (dirId) {
      filters.push(`dir_id = '${dirId}'`);
    }
    if (filePathPrefix) {
      filters.push(`file_path LIKE '${filePathPrefix}%'`);
    }

    if (filters.length > 0) {
      query = query.where(filters.join(' AND '));
    }

    const results = await query.toArray();

    return results.slice(0, topK).map((row) => ({
      chunk_id: row.chunk_id,
      score: this.distanceToScore(row._distance ?? 0, distanceType),
      document: row as VectorDocument,
    }));
  }

  async searchBySummary(
    vector: number[],
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    const {
      topK = 10,
      dirId,
      filePathPrefix,
      includeDeleted = false,
      distanceType = 'cosine',
    } = options;

    const table = await this.ensureTable();

    let query = table.vectorSearch(vector)
      .column('summary_vector')
      .distanceType(distanceType)
      .limit(topK * 2);

    const filters: string[] = [];
    if (!includeDeleted) {
      filters.push(`deleted_at = ''`);
    }
    if (dirId) {
      filters.push(`dir_id = '${dirId}'`);
    }
    if (filePathPrefix) {
      filters.push(`file_path LIKE '${filePathPrefix}%'`);
    }

    if (filters.length > 0) {
      query = query.where(filters.join(' AND '));
    }

    const results = await query.toArray();

    return results.slice(0, topK).map((row) => ({
      chunk_id: row.chunk_id,
      score: this.distanceToScore(row._distance ?? 0, distanceType),
      document: row as VectorDocument,
    }));
  }

  /**
   * 将距离转换为相似度分数
   */
  private distanceToScore(distance: number, distanceType: string): number {
    switch (distanceType) {
      case 'cosine':
        // cosine 距离范围 0-2，转换为 0-1 相似度
        return 1 - distance / 2;
      case 'l2':
        // L2 距离转换为相似度（经验公式）
        return 1 / (1 + distance);
      case 'dot':
        // 点积距离直接返回（需要归一化向量）
        return distance;
      default:
        return 1 - distance;
    }
  }

  async softDelete(chunkIds: string[]): Promise<void> {
    const table = await this.ensureTable();
    const now = new Date().toISOString();

    for (const chunkId of chunkIds) {
      await table.update({
        where: `chunk_id = '${chunkId}'`,
        values: { deleted_at: now },
      });
    }
  }

  async deleteByDirId(dirId: string): Promise<void> {
    const table = await this.ensureTable();
    await table.delete(`dir_id = '${dirId}'`);
  }

  async deleteByFileId(fileId: string): Promise<void> {
    const table = await this.ensureTable();
    await table.delete(`file_id = '${fileId}'`);
  }

  async updateFilePaths(dirId: string, oldPrefix: string, newPrefix: string): Promise<void> {
    // 用于目录移动/重命名
    // 注意：LanceDB 不支持复杂的 UPDATE，需要读取-修改-写入
    const table = await this.ensureTable();

    // 搜索所有匹配的记录
    const results = await table.vectorSearch(new Array(this.options.dimension).fill(0))
      .column('content_vector')
      .where(`dir_id = '${dirId}'`)
      .limit(10000)
      .toArray();

    for (const row of results) {
      if (row.file_path.startsWith(oldPrefix)) {
        await table.update({
          where: `chunk_id = '${row.chunk_id}'`,
          values: { file_path: row.file_path.replace(oldPrefix, newPrefix) },
        });
      }
    }
  }

  async compact(): Promise<number> {
    const table = await this.ensureTable();
    const beforeCount = await table.countRows();
    await table.delete(`deleted_at != ''`);
    const afterCount = await table.countRows();
    return beforeCount - afterCount;
  }

  async countRows(): Promise<number> {
    const table = await this.ensureTable();
    return table.countRows();
  }

  async close(): Promise<void> {
    this.table = null;
    this.db = null;
  }
}

export function createVectorStore(options: VectorStoreOptions): VectorStore {
  return new VectorStore(options);
}
```

---

## Task 4: 更新导出

**File:** `packages/search/src/vector-store/index.ts`

```typescript
export { VectorStore, createVectorStore } from './store';
export type { VectorStoreOptions, VectorSearchOptions } from './store';
```

**Update:** `packages/search/src/index.ts`

添加：
```typescript
export { VectorStore, createVectorStore } from './vector-store';
export type { VectorStoreOptions, VectorSearchOptions } from './vector-store';
```

---

## Task 5: 编写测试

**File:** `packages/search/src/vector-store/store.test.ts`

测试内容：
- [ ] 创建/连接数据库
- [ ] 添加文档
- [ ] 按 content_vector 搜索
- [ ] 按 summary_vector 搜索
- [ ] 按 dir_id 过滤
- [ ] 按 file_path 前缀过滤
- [ ] 软删除
- [ ] 物理删除
- [ ] 压缩

---

## 完成检查清单

- [ ] LanceDB 集成
- [ ] 向量搜索（content + summary）
- [ ] scope 过滤
- [ ] 软删除支持
- [ ] 批量操作
- [ ] 距离转相似度转换
- [ ] 单元测试

---

## 输出接口

```typescript
import { VectorStore, createVectorStore } from '@agent-fs/search';

const store = createVectorStore({
  storagePath: '~/.agent_fs/storage/vectors',
  dimension: 512,
});

await store.init();

await store.addDocuments([{
  chunk_id: 'chunk-001',
  file_id: 'file-001',
  dir_id: 'dir-001',
  rel_path: 'doc.md',
  file_path: '/project/doc.md',
  content: '文档内容',
  summary: '文档摘要',
  content_vector: [...],
  summary_vector: [...],
  locator: 'line:1-10',
  indexed_at: new Date().toISOString(),
  deleted_at: '',
}]);

const results = await store.searchByContent(queryVector, {
  topK: 10,
  filePathPrefix: '/path/to/project',
  distanceType: 'cosine',
});

// results[0].score 范围 0-1，越高越相似
```

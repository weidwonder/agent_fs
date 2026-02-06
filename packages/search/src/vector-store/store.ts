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

const toRecord = (doc: VectorDocument): Record<string, unknown> => ({ ...doc });

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
        chunk_line_start: 0,
        chunk_line_end: 0,
        content_vector: new Array(this.options.dimension).fill(0),
        summary_vector: new Array(this.options.dimension).fill(0),
        locator: '',
        indexed_at: '',
        deleted_at: '',
      };
      const seedData = [toRecord(emptyDoc)];
      this.table = await this.db.createTable(this.options.tableName, seedData);
      // 删除占位记录
      await this.table.delete(`chunk_id = ''`);
    }

    return this.table;
  }

  async addDocuments(docs: VectorDocument[]): Promise<void> {
    if (docs.length === 0) return;
    const table = await this.ensureTable();
    await table.add(docs.map((doc) => toRecord(doc)));
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

    let query = table
      .vectorSearch(vector)
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

    let query = table
      .vectorSearch(vector)
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

  async getByChunkIds(chunkIds: string[]): Promise<VectorDocument[]> {
    if (chunkIds.length === 0) return [];

    const table = await this.ensureTable();
    const filters = chunkIds.map((id) => `chunk_id = '${id}'`).join(' OR ');

    const query = table
      .vectorSearch(new Array(this.options.dimension).fill(0))
      .column('content_vector')
      .where(`deleted_at = '' AND (${filters})`)
      .limit(chunkIds.length);

    const rows = await query.toArray();
    return rows as VectorDocument[];
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

  async updateFilePaths(
    dirId: string,
    oldPrefix: string,
    newPrefix: string
  ): Promise<void> {
    // 用于目录移动/重命名
    // 注意：LanceDB 不支持复杂的 UPDATE，需要读取-修改-写入
    const table = await this.ensureTable();

    // 搜索所有匹配的记录
    const results = await table
      .vectorSearch(new Array(this.options.dimension).fill(0))
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

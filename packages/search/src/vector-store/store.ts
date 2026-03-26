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

  /** 多目录 ID 过滤（OR 关系） */
  dirIds?: string[];

  /** 文件路径前缀过滤 */
  filePathPrefix?: string;

  /** 是否包含已删除 */
  includeDeleted?: boolean;

  /** 距离类型 */
  distanceType?: 'l2' | 'cosine' | 'dot';

  /** postfilter 结果达到该阈值时不再回退 prefilter */
  minResultsBeforeFallback?: number;
}

export interface ChunkVectorUpdate {
  chunkId: string;
  summaryVector: number[];
  hybridVector: number[];
  indexedAt?: string;
}

const toRecord = (doc: VectorDocument): Record<string, unknown> => ({ ...doc });
const REQUIRED_SCHEMA_FIELDS = new Set([
  'chunk_id',
  'file_id',
  'dir_id',
  'rel_path',
  'file_path',
  'chunk_line_start',
  'chunk_line_end',
  'content_vector',
  'summary_vector',
  'hybrid_vector',
  'locator',
  'indexed_at',
  'deleted_at',
]);
const ESSENTIAL_SCALAR_INDEX_COLUMNS = ['dir_id', 'chunk_id'] as const;

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
      const isExpectedSchema = await this.hasExpectedSchema(this.table);
      if (!isExpectedSchema) {
        await this.db.dropTable(this.options.tableName);
        this.table = null;
      } else {
        await this.ensureScalarIndexes(this.table);
      }
    }
  }

  private async ensureTable(): Promise<lancedb.Table> {
    if (!this.db) throw new Error('Database not initialized');

    if (!this.table) {
      this.table = await this.createEmptyTable();
    }

    return this.table;
  }

  private async createEmptyTable(): Promise<lancedb.Table> {
    if (!this.db) throw new Error('Database not initialized');

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
      hybrid_vector: new Array(this.options.dimension).fill(0),
      locator: '',
      indexed_at: '',
      deleted_at: '',
    };
    const table = await this.db.createTable(this.options.tableName, [toRecord(emptyDoc)]);
    await table.delete(`chunk_id = ''`);
    await this.ensureScalarIndexes(table);
    return table;
  }

  private async ensureScalarIndexes(table: lancedb.Table): Promise<void> {
    const listIndices = (table as any).listIndices;
    const createIndex = (table as any).createIndex;
    if (typeof listIndices !== 'function' || typeof createIndex !== 'function') {
      return;
    }

    let indexedColumns = new Set<string>();
    try {
      const existingIndices = await listIndices.call(table) as Array<{ columns?: string[] }>;
      indexedColumns = new Set(
        (existingIndices || []).flatMap((index) => index.columns || [])
      );
    } catch {
      return;
    }

    for (const column of ESSENTIAL_SCALAR_INDEX_COLUMNS) {
      if (indexedColumns.has(column)) {
        continue;
      }
      try {
        await createIndex.call(table, column);
        indexedColumns.add(column);
      } catch {
        // 忽略索引创建失败，保持检索可用
      }
    }
  }

  private async hasExpectedSchema(table: lancedb.Table): Promise<boolean> {
    const schema = await table.schema();
    const existingFields = new Set(schema.fields.map((field) => field.name));

    if (existingFields.size !== REQUIRED_SCHEMA_FIELDS.size) {
      return false;
    }

    for (const name of REQUIRED_SCHEMA_FIELDS) {
      if (!existingFields.has(name)) {
        return false;
      }
    }

    return true;
  }

  async addDocuments(docs: VectorDocument[]): Promise<void> {
    if (docs.length === 0) return;
    const table = await this.ensureTable();
    await table.add(docs.map((doc) => toRecord(this.withHybridVector(doc))));
  }

  async searchByContent(
    vector: number[],
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    return this.searchByVectorColumn(vector, 'content_vector', options);
  }

  async searchBySummary(
    vector: number[],
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    return this.searchByVectorColumn(vector, 'summary_vector', options);
  }

  async searchByHybrid(
    vector: number[],
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    return this.searchByVectorColumn(vector, 'hybrid_vector', options);
  }

  private async searchByVectorColumn(
    vector: number[],
    vectorColumn: 'content_vector' | 'summary_vector' | 'hybrid_vector',
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    const {
      topK = 10,
      dirId,
      dirIds,
      filePathPrefix,
      includeDeleted = false,
      distanceType = 'cosine',
      minResultsBeforeFallback,
    } = options;
    const fallbackThreshold = Math.max(1, minResultsBeforeFallback ?? topK);

    const table = await this.ensureTable();

    const filters = this.buildFilters({
      includeDeleted,
      dirId,
      dirIds,
      filePathPrefix,
    });
    const filterStatement = filters.join(' AND ');

    const createQuery = () =>
      table
        .vectorSearch(vector)
        .column(vectorColumn)
        .distanceType(distanceType)
        .limit(topK * 2); // 多取一些，后面过滤后可能不够

    let results: any[] = [];
    if (filterStatement) {
      const postfilterResults = await this.tryPostfilterSearch(createQuery, filterStatement);
      if (postfilterResults.length >= fallbackThreshold) {
        results = postfilterResults;
      } else {
        results = await createQuery().where(filterStatement).toArray();
      }
    } else {
      results = await createQuery().toArray();
    }

    return results.slice(0, topK).map((row) => ({
      chunk_id: row.chunk_id,
      score: this.distanceToScore(row._distance ?? 0, distanceType),
      document: this.normalizeVectorDocument(row as VectorDocument),
    }));
  }

  private async tryPostfilterSearch(
    createQuery: () => any,
    filterStatement: string
  ): Promise<any[]> {
    try {
      const query = createQuery().where(filterStatement);
      if (typeof query.postfilter !== 'function') {
        return [];
      }
      const postfilterQuery = query.postfilter();
      if (!postfilterQuery || typeof postfilterQuery.toArray !== 'function') {
        return [];
      }
      return await postfilterQuery.toArray();
    } catch {
      return [];
    }
  }

  async getByChunkIds(chunkIds: string[]): Promise<VectorDocument[]> {
    if (chunkIds.length === 0) return [];

    const table = await this.ensureTable();
    const normalizedChunkIds = Array.from(
      new Set(
        chunkIds.filter((chunkId) => typeof chunkId === 'string' && chunkId.length > 0)
      )
    );
    if (normalizedChunkIds.length === 0) {
      return [];
    }

    const chunkFilter =
      normalizedChunkIds.length === 1
        ? `chunk_id = '${this.escapeLiteral(normalizedChunkIds[0])}'`
        : `chunk_id IN (${normalizedChunkIds
            .map((chunkId) => `'${this.escapeLiteral(chunkId)}'`)
            .join(', ')})`;
    const whereClause = `deleted_at = '' AND ${chunkFilter}`;

    const queryFactory = (table as any).query;
    if (typeof queryFactory === 'function') {
      const query = queryFactory.call(table).where(whereClause).limit(normalizedChunkIds.length);
      const rows = await query.toArray();
      return (rows as VectorDocument[]).map((row) => this.normalizeVectorDocument(row));
    }

    const fallback = table
      .vectorSearch(new Array(this.options.dimension).fill(0))
      .column('content_vector')
      .where(whereClause)
      .limit(normalizedChunkIds.length);
    const rows = await fallback.toArray();
    return (rows as VectorDocument[]).map((row) => this.normalizeVectorDocument(row));
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

  private withHybridVector(doc: VectorDocument): VectorDocument {
    const hybridVector =
      doc.hybrid_vector && doc.hybrid_vector.length > 0
        ? doc.hybrid_vector
        : this.composeHybridVector(doc.content_vector, doc.summary_vector);

    return {
      ...doc,
      hybrid_vector: hybridVector,
    };
  }

  private composeHybridVector(contentVector: number[], summaryVector: number[]): number[] {
    const dimension = Math.max(
      this.options.dimension,
      contentVector.length,
      summaryVector.length
    );
    const vector = new Array<number>(dimension).fill(0);

    for (let index = 0; index < dimension; index += 1) {
      const contentValue = contentVector[index] ?? 0;
      const summaryValue = summaryVector[index] ?? 0;
      vector[index] = (contentValue + summaryValue) / 2;
    }

    return vector;
  }

  private normalizeVectorDocument(doc: VectorDocument): VectorDocument {
    return {
      ...doc,
      content_vector: this.normalizeVector(doc.content_vector),
      summary_vector: this.normalizeVector(doc.summary_vector),
      hybrid_vector: this.normalizeVector(doc.hybrid_vector),
    };
  }

  private normalizeVector(raw: unknown): number[] {
    if (Array.isArray(raw)) {
      return raw.map((value) => this.normalizeNumber(value));
    }

    if (ArrayBuffer.isView(raw)) {
      const maybeArrayLike = raw as unknown as { length?: number };
      if (typeof maybeArrayLike.length === 'number') {
        return Array.from(raw as unknown as ArrayLike<number>, (value) =>
          this.normalizeNumber(value)
        );
      }
      return [];
    }

    if (raw && typeof raw === 'object') {
      const candidate = raw as {
        toArray?: () => unknown;
        values?: () => Iterable<unknown>;
        length?: number;
      };

      if (typeof candidate.toArray === 'function') {
        return this.normalizeVector(candidate.toArray());
      }

      if (typeof candidate.values === 'function') {
        try {
          return Array.from(candidate.values(), (value) => this.normalizeNumber(value));
        } catch {
          // 忽略 values 迭代失败，继续兜底处理
        }
      }

      if (typeof candidate.length === 'number') {
        try {
          return Array.from(candidate as ArrayLike<unknown>, (value) =>
            this.normalizeNumber(value)
          );
        } catch {
          // 忽略 ArrayLike 转换失败，继续兜底处理
        }
      }
    }

    return [];
  }

  private normalizeNumber(value: unknown): number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private buildFilters(options: {
    includeDeleted: boolean;
    dirId?: string;
    dirIds?: string[];
    filePathPrefix?: string;
  }): string[] {
    const filters: string[] = [];
    if (!options.includeDeleted) {
      filters.push(`deleted_at = ''`);
    }

    const normalizedDirIds = new Set<string>();
    if (typeof options.dirId === 'string' && options.dirId.length > 0) {
      normalizedDirIds.add(options.dirId);
    }
    for (const dirId of options.dirIds || []) {
      if (typeof dirId === 'string' && dirId.length > 0) {
        normalizedDirIds.add(dirId);
      }
    }

    if (normalizedDirIds.size === 1) {
      const dirId = [...normalizedDirIds][0];
      filters.push(`dir_id = '${this.escapeLiteral(dirId)}'`);
    } else if (normalizedDirIds.size > 1) {
      const dirFilter = [...normalizedDirIds]
        .map((dirId) => `'${this.escapeLiteral(dirId)}'`)
        .join(', ');
      filters.push(`dir_id IN (${dirFilter})`);
    }

    if (options.filePathPrefix) {
      filters.push(`file_path LIKE '${this.escapeLiteral(options.filePathPrefix)}%'`);
    }

    return filters;
  }

  private escapeLiteral(value: string): string {
    return value.replace(/'/gu, "''");
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
    await this.deleteByDirIds([dirId]);
  }

  async deleteByDirIds(dirIds: string[]): Promise<void> {
    const normalizedDirIds = Array.from(
      new Set(
        dirIds.filter((dirId) => typeof dirId === 'string' && dirId.length > 0)
      )
    );
    if (normalizedDirIds.length === 0) {
      return;
    }

    const table = await this.ensureTable();
    const filter =
      normalizedDirIds.length === 1
        ? `dir_id = '${this.escapeLiteral(normalizedDirIds[0])}'`
        : `dir_id IN (${normalizedDirIds
            .map((dirId) => `'${this.escapeLiteral(dirId)}'`)
            .join(', ')})`;
    await table.delete(filter);
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

  async updateChunkVectors(updates: ChunkVectorUpdate[]): Promise<void> {
    if (updates.length === 0) {
      return;
    }

    const table = await this.ensureTable();
    const defaultIndexedAt = new Date().toISOString();

    for (const update of updates) {
      if (!update.chunkId) {
        continue;
      }

      await table.update({
        where: `chunk_id = '${this.escapeLiteral(update.chunkId)}'`,
        values: {
          summary_vector: update.summaryVector,
          hybrid_vector: update.hybridVector,
          indexed_at: update.indexedAt ?? defaultIndexedAt,
          deleted_at: '',
        },
      });
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

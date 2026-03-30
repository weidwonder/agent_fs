// packages/storage-cloud/src/cloud-vector-store-adapter.ts

import type { VectorDocument } from '@agent-fs/core';
import type {
  VectorStoreAdapter,
  VectorSearchParams,
  VectorSearchResult,
} from '@agent-fs/storage-adapter';
import { getPool } from './db.js';

// pgvector helper — dynamic import with fallback
async function toSql(vector: number[]): Promise<string> {
  try {
    const pgv = await import('pgvector');
    return (pgv.default ?? pgv).toSql(vector) as string;
  } catch {
    return `[${vector.join(',')}]`;
  }
}

export class CloudVectorStoreAdapter implements VectorStoreAdapter {
  constructor(private readonly tenantId: string) {}

  async init(): Promise<void> {
    // Pool already initialised globally; pgvector extension enabled in initDb
  }

  async addDocuments(docs: VectorDocument[]): Promise<void> {
    if (docs.length === 0) return;
    const pool = getPool();

    const values: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;

    for (const doc of docs) {
      const vecSql = await toSql(doc.content_vector);
      placeholders.push(
        `($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5},$${idx + 6},$${idx + 7},$${idx + 8},$${idx + 9}::vector,$${idx + 10})`,
      );
      values.push(
        doc.chunk_id,
        doc.file_id,
        doc.dir_id,
        this.tenantId,
        doc.rel_path,
        doc.file_path,
        doc.chunk_line_start,
        doc.chunk_line_end,
        doc.locator,
        vecSql,
        doc.indexed_at ? new Date(doc.indexed_at) : new Date(),
      );
      idx += 11;
    }

    await pool.query(
      `INSERT INTO chunks
         (id, file_id, dir_id, tenant_id, rel_path, file_path,
          chunk_line_start, chunk_line_end, locator, content_vector, indexed_at)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (id) DO UPDATE SET
         content_vector = EXCLUDED.content_vector,
         indexed_at     = EXCLUDED.indexed_at`,
      values,
    );
  }

  async searchByVector(params: VectorSearchParams): Promise<VectorSearchResult[]> {
    const pool = getPool();
    const vecSql = await toSql(params.vector);
    const queryParams: unknown[] = [vecSql, this.tenantId, params.topK];

    let sql: string;
    if (params.dirIds.length > 0) {
      queryParams.push(params.dirIds);
      sql = `
        SELECT id AS chunk_id, file_id, dir_id, rel_path, file_path,
               chunk_line_start, chunk_line_end, locator, indexed_at,
               1 - (content_vector <=> $1::vector) AS score
        FROM chunks
        WHERE tenant_id = $2
          AND dir_id = ANY($4)
          AND deleted_at IS NULL
        ORDER BY content_vector <=> $1::vector
        LIMIT $3`;
    } else {
      sql = `
        SELECT id AS chunk_id, file_id, dir_id, rel_path, file_path,
               chunk_line_start, chunk_line_end, locator, indexed_at,
               1 - (content_vector <=> $1::vector) AS score
        FROM chunks
        WHERE tenant_id = $2
          AND deleted_at IS NULL
        ORDER BY content_vector <=> $1::vector
        LIMIT $3`;
    }

    const result = await pool.query(sql, queryParams);
    return result.rows.map((row) => ({
      chunkId: row.chunk_id as string,
      score: parseFloat(row.score as string),
      document: this.rowToDocument(row),
    }));
  }

  async getByChunkIds(chunkIds: string[]): Promise<VectorDocument[]> {
    if (chunkIds.length === 0) return [];
    const result = await getPool().query(
      `SELECT id AS chunk_id, file_id, dir_id, rel_path, file_path,
              chunk_line_start, chunk_line_end, locator, indexed_at
       FROM chunks
       WHERE id = ANY($1) AND tenant_id = $2 AND deleted_at IS NULL`,
      [chunkIds, this.tenantId],
    );
    return result.rows.map((row) => this.rowToDocument(row));
  }

  async deleteByFileId(fileId: string): Promise<void> {
    await getPool().query(
      'DELETE FROM chunks WHERE file_id = $1 AND tenant_id = $2',
      [fileId, this.tenantId],
    );
  }

  async deleteByDirId(dirId: string): Promise<void> {
    await getPool().query(
      'DELETE FROM chunks WHERE dir_id = $1 AND tenant_id = $2',
      [dirId, this.tenantId],
    );
  }

  async deleteByDirIds(dirIds: string[]): Promise<void> {
    if (dirIds.length === 0) return;
    await getPool().query(
      'DELETE FROM chunks WHERE dir_id = ANY($1) AND tenant_id = $2',
      [dirIds, this.tenantId],
    );
  }

  async close(): Promise<void> {
    // Pool is shared; caller manages lifecycle via closeDb()
  }

  private rowToDocument(row: Record<string, unknown>): VectorDocument {
    return {
      chunk_id: row.chunk_id as string,
      file_id: row.file_id as string,
      dir_id: row.dir_id as string,
      rel_path: row.rel_path as string,
      file_path: row.file_path as string,
      chunk_line_start: row.chunk_line_start as number,
      chunk_line_end: row.chunk_line_end as number,
      content_vector: [],
      locator: row.locator as string,
      indexed_at: (row.indexed_at instanceof Date ? row.indexed_at.toISOString() : row.indexed_at as string) ?? '',
      deleted_at: '',
    };
  }
}

import PgBoss from 'pg-boss';
import { createCloudAdapter, getPool } from '@agent-fs/storage-cloud';
import type { VectorDocument } from '@agent-fs/core';
import type { InvertedIndexEntry } from '@agent-fs/storage-adapter';
import { enqueueReembed } from '../jobs/queue.js';

export interface ImportChunk {
  content: string;
  locator: string;
  lineStart: number;
  lineEnd: number;
  vector?: number[] | null;
}

export interface ImportFileRequest {
  fileName: string;
  dirRelativePath: string;
  summary?: string;
  sizeBytes: number;
  archive: Record<string, string>;
  chunks: ImportChunk[];
}

export interface ImportFileResult {
  fileId: string;
  status: 'indexed' | 'embedding';
}

export class ImportService {
  constructor(private readonly boss: PgBoss) {}

  async importFile(
    tenantId: string,
    projectId: string,
    req: ImportFileRequest,
  ): Promise<ImportFileResult> {
    const pool = getPool();
    const dirId = await this.findOrCreateDirectory(tenantId, projectId, req.dirRelativePath);
    const fileId = await this.createFileRecord(pool, dirId, tenantId, req);
    const hasVectors = req.chunks.length > 0 && req.chunks.every((chunk) => chunk.vector != null);
    const filePath = req.dirRelativePath === '.' ? req.fileName : `${req.dirRelativePath}/${req.fileName}`;

    try {
      const adapter = createCloudAdapter({ tenantId });
      await adapter.init();
      try {
        await adapter.archive.write(fileId, { files: req.archive });
        await adapter.invertedIndex.addFile(
          fileId,
          dirId,
          req.chunks.map<InvertedIndexEntry>((chunk, index) => ({
            text: chunk.content,
            chunkId: `${fileId}:${index}`,
            locator: chunk.locator,
          })),
        );
        await adapter.vector.addDocuments(
          this.buildVectorDocuments(fileId, dirId, filePath, req, hasVectors),
        );
      } finally {
        await adapter.close();
      }

      const finalStatus = hasVectors ? 'indexed' : 'embedding';
      await pool.query(
        `UPDATE files
         SET status = $2, chunk_count = $3, summary = $4,
             afd_key = $5, indexed_at = now(), updated_at = now()
         WHERE id = $1`,
        [fileId, finalStatus, req.chunks.length, req.summary ?? '', `${tenantId}/${fileId}`],
      );

      if (!hasVectors) {
        await enqueueReembed(this.boss, { tenantId, fileId, directoryId: dirId });
      }

      return { fileId, status: finalStatus };
    } catch (error) {
      await this.cleanupImportedData(tenantId, fileId);
      await pool.query(
        "UPDATE files SET status = 'failed', error_message = $2, updated_at = now() WHERE id = $1",
        [fileId, error instanceof Error ? error.message.slice(0, 500) : 'Unknown error'],
      );
      throw error;
    }
  }

  private buildVectorDocuments(
    fileId: string,
    dirId: string,
    filePath: string,
    req: ImportFileRequest,
    hasVectors: boolean,
  ): VectorDocument[] {
    const dimension = hasVectors
      ? req.chunks[0]!.vector!.length
      : Number(process.env['EMBEDDING_DIMENSION'] ?? '512');

    return req.chunks.map((chunk, index) => ({
      chunk_id: `${fileId}:${index}`,
      file_id: fileId,
      dir_id: dirId,
      rel_path: req.fileName,
      file_path: filePath,
      chunk_line_start: chunk.lineStart,
      chunk_line_end: chunk.lineEnd,
      content_vector: hasVectors ? chunk.vector! : new Array(dimension).fill(0),
      locator: chunk.locator,
      indexed_at: new Date().toISOString(),
      deleted_at: '',
    }));
  }

  private async cleanupImportedData(tenantId: string, fileId: string): Promise<void> {
    try {
      const adapter = createCloudAdapter({ tenantId });
      await adapter.init();
      try {
        await adapter.vector.deleteByFileId(fileId);
        await adapter.invertedIndex.removeFile(fileId);
        await adapter.archive.delete(fileId);
      } finally {
        await adapter.close();
      }
    } catch {
      // 清理只做尽力而为，保留原始错误给上层处理。
    }
  }

  private async createFileRecord(
    pool: ReturnType<typeof getPool>,
    dirId: string,
    tenantId: string,
    req: ImportFileRequest,
  ): Promise<string> {
    const dupCheck = await pool.query(
      `SELECT id FROM files
       WHERE directory_id = $1 AND tenant_id = $2 AND name = $3`,
      [dirId, tenantId, req.fileName],
    );
    if (dupCheck.rows.length > 0) {
      throw new Error('FILE_EXISTS');
    }

    const fileResult = await pool.query(
      `INSERT INTO files (directory_id, tenant_id, name, size_bytes, status)
       VALUES ($1, $2, $3, $4, 'importing') RETURNING id`,
      [dirId, tenantId, req.fileName, req.sizeBytes],
    );

    return fileResult.rows[0].id as string;
  }

  private async findOrCreateDirectory(
    tenantId: string,
    projectId: string,
    relativePath: string,
  ): Promise<string> {
    const pool = getPool();
    const existing = await pool.query(
      `SELECT id FROM directories
       WHERE project_id = $1 AND tenant_id = $2 AND relative_path = $3`,
      [projectId, tenantId, relativePath],
    );
    if (existing.rows.length > 0) {
      return existing.rows[0].id as string;
    }

    const result = await pool.query(
      `INSERT INTO directories (project_id, tenant_id, relative_path)
       VALUES ($1, $2, $3) RETURNING id`,
      [projectId, tenantId, relativePath],
    );

    return result.rows[0].id as string;
  }
}

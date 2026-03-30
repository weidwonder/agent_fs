// packages/server/src/services/indexing-service.ts

import PgBoss from 'pg-boss';
import { getPool, putObject, deleteObject } from '@agent-fs/storage-cloud';
import { enqueueIndexing } from '../jobs/queue.js';

export interface FileRecord {
  id: string;
  name: string;
  size_bytes: number;
  chunk_count: number | null;
  status: string;
  error_message: string | null;
  indexed_at: string | null;
  created_at: string;
}

export class IndexingService {
  constructor(private readonly boss: PgBoss) {}

  async uploadAndEnqueue(
    tenantId: string,
    projectId: string,
    fileName: string,
    fileBuffer: Buffer,
  ): Promise<{ fileId: string }> {
    const pool = getPool();

    // Get root directory for project
    const dirResult = await pool.query(
      `SELECT id FROM directories WHERE project_id = $1 AND relative_path = '.' AND tenant_id = $2`,
      [projectId, tenantId],
    );

    if (dirResult.rows.length === 0) {
      throw new Error(`No root directory found for project ${projectId}`);
    }
    const directoryId = dirResult.rows[0].id as string;

    // Insert file record with status 'pending'
    const fileResult = await pool.query(
      `INSERT INTO files (directory_id, tenant_id, name, size_bytes, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
      [directoryId, tenantId, fileName, fileBuffer.length],
    );
    const fileId = fileResult.rows[0].id as string;

    // Upload to S3 temp path
    const s3TempKey = `${tenantId}/tmp/${fileId}/${fileName}`;
    await putObject(s3TempKey, fileBuffer);

    // Enqueue indexing job
    await enqueueIndexing(this.boss, {
      tenantId,
      projectId,
      directoryId,
      fileId,
      fileName,
      s3TempKey,
    });

    return { fileId };
  }

  async listFiles(tenantId: string, projectId: string): Promise<FileRecord[]> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT f.id, f.name, f.size_bytes, f.chunk_count, f.status,
              f.error_message, f.indexed_at, f.created_at
       FROM files f
       JOIN directories d ON f.directory_id = d.id
       WHERE d.project_id = $1 AND f.tenant_id = $2
       ORDER BY f.created_at DESC`,
      [projectId, tenantId],
    );
    return result.rows as FileRecord[];
  }

  async deleteFile(tenantId: string, fileId: string): Promise<boolean> {
    const pool = getPool();

    // Get S3 key before deleting
    const fileRow = await pool.query(
      'SELECT afd_key FROM files WHERE id = $1 AND tenant_id = $2',
      [fileId, tenantId],
    );

    const result = await pool.query(
      'DELETE FROM files WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [fileId, tenantId],
    );

    if ((result.rowCount ?? 0) === 0) return false;

    // Best-effort cleanup of S3 temp key
    const afdKey = fileRow.rows[0]?.afd_key as string | undefined;
    if (afdKey) {
      try {
        await deleteObject(afdKey);
      } catch {
        // Non-blocking
      }
    }

    return true;
  }
}

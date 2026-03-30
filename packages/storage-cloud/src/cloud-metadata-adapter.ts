// packages/storage-cloud/src/cloud-metadata-adapter.ts

import type { IndexMetadata } from '@agent-fs/core';
import type { MetadataAdapter } from '@agent-fs/storage-adapter';
import { getPool } from './db.js';
import { putObject, getObject, objectExists, listObjects } from './s3.js';

const MEMORY_PREFIX = 'memory';

export class CloudMetadataAdapter implements MetadataAdapter {
  constructor(private readonly tenantId: string) {}

  async readIndexMetadata(dirId: string): Promise<IndexMetadata | null> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT metadata FROM directories WHERE id = $1 AND tenant_id = $2`,
      [dirId, this.tenantId],
    );
    if (result.rows.length === 0) return null;
    const meta = result.rows[0].metadata as Record<string, unknown>;
    if (!meta || Object.keys(meta).length === 0) return null;
    return meta as unknown as IndexMetadata;
  }

  async writeIndexMetadata(dirId: string, metadata: IndexMetadata): Promise<void> {
    await getPool().query(
      `UPDATE directories SET metadata = $1 WHERE id = $2 AND tenant_id = $3`,
      [JSON.stringify(metadata), dirId, this.tenantId],
    );
  }

  async deleteIndexMetadata(dirId: string): Promise<void> {
    await getPool().query(
      `UPDATE directories SET metadata = '{}' WHERE id = $1 AND tenant_id = $2`,
      [dirId, this.tenantId],
    );
  }

  async listSubdirectories(
    dirId: string,
  ): Promise<{ dirId: string; relativePath: string; summary?: string }[]> {
    const result = await getPool().query(
      `SELECT id, relative_path, summary FROM directories WHERE parent_dir_id = $1 AND tenant_id = $2`,
      [dirId, this.tenantId],
    );
    return result.rows.map((row) => ({
      dirId: row.id as string,
      relativePath: row.relative_path as string,
      summary: (row.summary as string) ?? undefined,
    }));
  }

  async listProjects(): Promise<
    { projectId: string; name: string; rootDirId: string; summary?: string }[]
  > {
    const result = await getPool().query(
      `SELECT p.id, p.name,
              (SELECT d.id FROM directories d WHERE d.project_id = p.id AND d.parent_dir_id IS NULL LIMIT 1) AS root_dir_id
       FROM projects p
       WHERE p.tenant_id = $1`,
      [this.tenantId],
    );
    return result.rows
      .filter((row) => row.root_dir_id)
      .map((row) => ({
        projectId: row.id as string,
        name: row.name as string,
        rootDirId: row.root_dir_id as string,
      }));
  }

  async readProjectMemory(projectId: string): Promise<{
    memoryPath: string;
    projectMd: string;
    files: { name: string; size: number }[];
  } | null> {
    const prefix = `${this.tenantId}/${MEMORY_PREFIX}/${projectId}/`;
    const keys = await listObjects(prefix);
    if (keys.length === 0) return null;

    const projectMdKey = `${prefix}project.md`;
    let projectMd = '';
    if (await objectExists(projectMdKey)) {
      const buf = await getObject(projectMdKey);
      projectMd = buf.toString('utf-8');
    }

    const files = keys.map((k) => ({
      name: k.replace(prefix, ''),
      size: 0, // size not available without HeadObject per file
    }));

    return { memoryPath: prefix, projectMd, files };
  }

  async writeProjectMemoryFile(
    projectId: string,
    fileName: string,
    content: string,
  ): Promise<void> {
    const key = `${this.tenantId}/${MEMORY_PREFIX}/${projectId}/${fileName}`;
    await putObject(key, Buffer.from(content, 'utf-8'));
  }
}

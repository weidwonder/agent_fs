// packages/server/src/services/mcp-tool-service.ts

import type { StorageAdapter } from '@agent-fs/storage-adapter';
import { getPool } from '@agent-fs/storage-cloud';
import type { SearchService } from './search-service.js';
import type { IndexingService } from './indexing-service.js';

export class McpToolService {
  constructor(
    private readonly searchService: SearchService,
    private readonly indexingService: IndexingService,
  ) {}

  async listIndexes(tenantId: string) {
    const pool = getPool();
    const result = await pool.query(
      `SELECT p.id, p.name, p.created_at,
              COUNT(f.id) AS file_count,
              COALESCE(SUM(f.chunk_count), 0) AS total_chunks
       FROM projects p
       LEFT JOIN directories d ON d.project_id = p.id
       LEFT JOIN files f ON f.directory_id = d.id AND f.status = 'indexed'
       WHERE p.tenant_id = $1
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [tenantId],
    );
    return result.rows;
  }

  async dirTree(tenantId: string, scope: string, depth: number = 2) {
    const pool = getPool();
    const result = await pool.query(
      `WITH RECURSIVE tree AS (
         SELECT id, relative_path, summary, parent_dir_id, 0 AS level
         FROM directories
         WHERE (id = $1 OR project_id = $1)
           AND project_id IN (SELECT id FROM projects WHERE tenant_id = $2)
           AND parent_dir_id IS NULL
         UNION ALL
         SELECT d.id, d.relative_path, d.summary, d.parent_dir_id, t.level + 1
         FROM directories d
         JOIN tree t ON d.parent_dir_id = t.id
         WHERE t.level < $3
       )
       SELECT t.id, t.relative_path, t.summary, t.parent_dir_id, t.level,
              COALESCE(
                json_agg(
                  json_build_object('name', f.name, 'summary', f.summary)
                ) FILTER (WHERE f.id IS NOT NULL),
                '[]'
              ) AS files
       FROM tree t
       LEFT JOIN files f ON f.directory_id = t.id AND f.status = 'indexed'
       GROUP BY t.id, t.relative_path, t.summary, t.parent_dir_id, t.level
       ORDER BY t.level, t.relative_path`,
      [scope, tenantId, depth],
    );
    return result.rows;
  }

  async search(
    tenantId: string,
    args: { query: string; keyword?: string; scope?: string | string[]; top_k?: number },
    adapter: StorageAdapter,
  ) {
    return this.searchService.search(
      {
        tenantId,
        query: args.query,
        keyword: args.keyword,
        scope: args.scope,
        topK: args.top_k,
      },
      adapter,
    );
  }

  async getChunk(tenantId: string, chunkId: string, adapter: StorageAdapter) {
    // adapter is tenant-scoped (created with tenantId); getByChunkIds enforces
    // AND tenant_id = $2 in the SQL query — cross-tenant access is prevented.
    const docs = await adapter.vector.getByChunkIds([chunkId]);
    if (docs.length === 0) {
      // Either the chunk does not exist or belongs to a different tenant
      return { error: `Chunk not found or access denied for tenant ${tenantId}` };
    }

    const doc = docs[0];
    let content = '';
    try {
      content = await adapter.archive.read(doc.file_id, 'content.md');
      if (doc.chunk_line_start && doc.chunk_line_end) {
        const lines = content.split('\n');
        content = lines.slice(doc.chunk_line_start - 1, doc.chunk_line_end).join('\n');
      }
    } catch {
      content = '(archive not available)';
    }

    return {
      chunkId,
      fileId: doc.file_id,
      content,
      locator: doc.locator,
      lineStart: doc.chunk_line_start,
      lineEnd: doc.chunk_line_end,
    };
  }

  async getProjectMemory(
    tenantId: string,
    projectId: string,
    adapter: StorageAdapter,
  ) {
    // adapter is tenant-scoped; S3 keys are prefixed with tenantId in CloudMetadataAdapter
    return adapter.metadata.readProjectMemory(projectId);
  }

  async indexDocuments(
    tenantId: string,
    projectId: string,
    urls: string[],
  ): Promise<{ url: string; fileId?: string; error?: string }[]> {
    const results: { url: string; fileId?: string; error?: string }[] = [];

    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        const fileName =
          new URL(url).pathname.split('/').pop() ?? 'document';
        const { fileId } = await this.indexingService.uploadAndEnqueue(
          tenantId,
          projectId,
          fileName,
          buffer,
        );
        results.push({ url, fileId });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ url, error: message });
      }
    }

    return results;
  }
}

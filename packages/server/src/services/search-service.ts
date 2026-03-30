// packages/server/src/services/search-service.ts

import type { StorageAdapter } from '@agent-fs/storage-adapter';
import type { EmbeddingService } from '@agent-fs/llm';
import { getPool } from '@agent-fs/storage-cloud';

export interface SearchParams {
  tenantId: string;
  query: string;
  keyword?: string;
  scope?: string | string[];
  topK?: number;
}

export interface SearchResult {
  chunkId: string;
  score: number;
  fileId: string | undefined;
  dirId: string | undefined;
  filePath: string;
  locator: string;
  lineStart: number | undefined;
  lineEnd: number | undefined;
}

export class SearchService {
  constructor(private readonly embeddingService: EmbeddingService) {}

  async search(
    params: SearchParams,
    adapter: StorageAdapter,
  ): Promise<{ results: SearchResult[] }> {
    const { tenantId, query, keyword, scope, topK = 10 } = params;

    const dirIds = await this.resolveDirIds(tenantId, scope);

    // Vector search
    const queryVector = await this.embeddingService.embed(query);
    const vectorResults = await adapter.vector.searchByVector({
      vector: queryVector,
      dirIds,
      topK: topK * 2,
      mode: 'postfilter',
    });

    // Inverted index search — tokenize the query text
    const searchText = keyword ?? query;
    const terms = searchText
      .split(/\s+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);

    const invertedResults =
      terms.length > 0
        ? await adapter.invertedIndex.search({ terms, dirIds, topK: topK * 2 })
        : [];

    // RRF fusion
    const k = 60;
    const scoreMap = new Map<
      string,
      {
        chunkId: string;
        score: number;
        vectorDoc?: (typeof vectorResults)[0]['document'];
        invertedResult?: (typeof invertedResults)[0];
      }
    >();

    vectorResults.forEach((r, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      scoreMap.set(r.chunkId, {
        chunkId: r.chunkId,
        score: rrfScore,
        vectorDoc: r.document,
      });
    });

    invertedResults.forEach((r, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      const existing = scoreMap.get(r.chunkId);
      if (existing) {
        existing.score += rrfScore;
        existing.invertedResult = r;
      } else {
        scoreMap.set(r.chunkId, {
          chunkId: r.chunkId,
          score: rrfScore,
          invertedResult: r,
        });
      }
    });

    const fused = [...scoreMap.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // Enrich missing docs from vector store
    const missingIds = fused
      .filter((f) => !f.vectorDoc)
      .map((f) => f.chunkId);

    const extraDocs =
      missingIds.length > 0
        ? await adapter.vector.getByChunkIds(missingIds)
        : [];
    const docMap = new Map(extraDocs.map((d) => [d.chunk_id, d]));

    const results: SearchResult[] = fused.map((f) => {
      const doc = f.vectorDoc ?? docMap.get(f.chunkId);
      return {
        chunkId: f.chunkId,
        score: f.score,
        fileId: doc?.file_id ?? f.invertedResult?.fileId,
        dirId: doc?.dir_id ?? f.invertedResult?.dirId,
        filePath: doc?.file_path ?? '',
        locator: doc?.locator ?? f.invertedResult?.locator ?? '',
        lineStart: doc?.chunk_line_start,
        lineEnd: doc?.chunk_line_end,
      };
    });

    return { results };
  }

  private async resolveDirIds(
    tenantId: string,
    scope?: string | string[],
  ): Promise<string[]> {
    const pool = getPool();
    const scopes = !scope ? [] : Array.isArray(scope) ? scope : [scope];

    if (scopes.length === 0) {
      const result = await pool.query(
        `SELECT d.id FROM directories d
         JOIN projects p ON d.project_id = p.id
         WHERE p.tenant_id = $1`,
        [tenantId],
      );
      return result.rows.map((r: { id: string }) => r.id);
    }

    const result = await pool.query(
      `SELECT d.id FROM directories d
       WHERE (d.project_id = ANY($1) OR d.id = ANY($1))
         AND d.project_id IN (SELECT id FROM projects WHERE tenant_id = $2)`,
      [scopes, tenantId],
    );
    return result.rows.map((r: { id: string }) => r.id);
  }
}

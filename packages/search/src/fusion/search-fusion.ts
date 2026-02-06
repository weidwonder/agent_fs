import type { SearchOptions, SearchResponse, SearchResult } from '@agent-fs/core';
import type { VectorStore } from '../vector-store';
import type { BM25Index } from '../bm25';
import type { EmbeddingService } from '@agent-fs/llm';
import { fusionRRF, DEFAULT_RRF_PARAMS, type RRFParams } from './rrf';

export interface FusionOptions {
  rrfParams?: RRFParams;
  useContentVector?: boolean;
  useSummaryVector?: boolean;
  useBM25?: boolean;
}

export class SearchFusion {
  private vectorStore: VectorStore;
  private bm25Index: BM25Index;
  private embeddingService: EmbeddingService;

  constructor(vectorStore: VectorStore, bm25Index: BM25Index, embeddingService: EmbeddingService) {
    this.vectorStore = vectorStore;
    this.bm25Index = bm25Index;
    this.embeddingService = embeddingService;
  }

  async search(options: SearchOptions, fusionOptions: FusionOptions = {}): Promise<SearchResponse> {
    const {
      rrfParams = DEFAULT_RRF_PARAMS,
      useContentVector = true,
      useSummaryVector = true,
      useBM25 = true,
    } = fusionOptions;

    const startTime = Date.now();
    const { query, keyword, scope, topK = 10 } = options;
    const scopes = Array.isArray(scope) ? scope : [scope];
    const filePathPrefix = scopes[0];

    const lists: { name: string; items: SearchResult[] }[] = [];

    let queryVector: number[] | null = null;
    if (useContentVector || useSummaryVector) {
      queryVector = await this.embeddingService.embed(query);
    }

    if (useContentVector && queryVector) {
      const results = await this.vectorStore.searchByContent(queryVector, {
        topK: topK * 2,
        filePathPrefix,
      });

      lists.push({
        name: 'content_vector',
        items: results.map((r) => ({
          chunkId: r.chunk_id,
          score: r.score,
          content: '',
          summary: '',
          source: {
            filePath: r.document.file_path,
            locator: r.document.locator,
          },
        })),
      });
    }

    if (useSummaryVector && queryVector) {
      const results = await this.vectorStore.searchBySummary(queryVector, {
        topK: topK * 2,
        filePathPrefix,
      });

      lists.push({
        name: 'summary_vector',
        items: results.map((r) => ({
          chunkId: r.chunk_id,
          score: r.score,
          content: '',
          summary: '',
          source: {
            filePath: r.document.file_path,
            locator: r.document.locator,
          },
        })),
      });
    }

    if (useBM25) {
      const searchQuery = keyword || query;
      const results = this.bm25Index.search(searchQuery, {
        topK: topK * 2,
        filePathPrefix,
      });

      lists.push({
        name: 'bm25',
        items: results.map((r) => ({
          chunkId: r.chunk_id,
          score: r.score,
          content: r.document.content,
          summary: '',
          source: {
            filePath: r.document.file_path,
            locator: '',
          },
        })),
      });
    }

    const fused = fusionRRF(
      lists,
      (item) => item.chunkId,
      (existing, newItem) => ({
        ...existing,
        summary: existing.summary || newItem.summary,
        source: {
          filePath: existing.source.filePath,
          locator: existing.source.locator || newItem.source.locator,
        },
      }),
      rrfParams
    );

    const missingItems = fused.filter((item) => !item.item.source.locator);
    if (missingItems.length > 0) {
      const missingIds = Array.from(
        new Set(missingItems.map((item) => item.item.chunkId))
      );
      const docs = await this.vectorStore.getByChunkIds(missingIds);
      const docMap = new Map(docs.map((doc) => [doc.chunk_id, doc]));

      for (const fusedItem of missingItems) {
        const doc = docMap.get(fusedItem.item.chunkId);
        if (!doc) continue;
        if (!fusedItem.item.source.locator) {
          fusedItem.item.source.locator = doc.locator;
        }
      }
    }

    const results = fused.slice(0, topK).map((f) => ({
      ...f.item,
      score: f.score,
    }));

    return {
      results,
      meta: {
        totalSearched: lists.reduce((sum, list) => sum + list.items.length, 0),
        fusionMethod: 'rrf',
        elapsedMs: Date.now() - startTime,
      },
    };
  }
}

export function createSearchFusion(
  vectorStore: VectorStore,
  bm25Index: BM25Index,
  embeddingService: EmbeddingService
): SearchFusion {
  return new SearchFusion(vectorStore, bm25Index, embeddingService);
}

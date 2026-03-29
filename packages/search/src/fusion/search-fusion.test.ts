import { describe, expect, it, vi } from 'vitest';
import { SearchFusion } from './search-fusion';
import type { VectorDocument, VectorSearchResult, BM25Document, BM25SearchResult } from '@agent-fs/core';
import type { VectorStore } from '../vector-store';
import type { BM25Index } from '../bm25';
import type { EmbeddingService } from '@agent-fs/llm';

const createVectorDoc = (id: string, filePath: string, locator = `loc-${id}`): VectorDocument => ({
  chunk_id: id,
  file_id: `file_${id}`,
  dir_id: 'dir1',
  rel_path: filePath.split('/').pop() ?? '',
  file_path: filePath,
  chunk_line_start: 1,
  chunk_line_end: 1,
  content_vector: [0, 0],
  locator,
  indexed_at: '2025-02-02T00:00:00.000Z',
  deleted_at: '',
});

const createVectorResult = (doc: VectorDocument, score = 0.9): VectorSearchResult => ({
  chunk_id: doc.chunk_id,
  score,
  document: doc,
});

const createBm25Doc = (id: string, filePath: string): BM25Document => ({
  chunk_id: id,
  file_id: `file_${id}`,
  dir_id: 'dir1',
  file_path: filePath,
  content: `content-${id}`,
  tokens: [],
  indexed_at: '2025-02-02T00:00:00.000Z',
  deleted_at: '',
});

const createBm25Result = (doc: BM25Document, score = 5): BM25SearchResult => ({
  chunk_id: doc.chunk_id,
  score,
  document: doc,
});

const createFusion = (options: {
  contentResults?: VectorSearchResult[];
  bm25Results?: BM25SearchResult[];
  getByChunkIdsResults?: VectorDocument[];
} = {}) => {
  const {
    contentResults = [],
    bm25Results = [],
    getByChunkIdsResults = [],
  } = options;

  const vectorStore = {
    searchByContent: vi.fn().mockResolvedValue(contentResults),
    getByChunkIds: vi.fn().mockResolvedValue(getByChunkIdsResults),
  } as unknown as VectorStore;

  const bm25Index = {
    search: vi.fn().mockReturnValue(bm25Results),
  } as unknown as BM25Index;

  const embeddingService = {
    embed: vi.fn().mockResolvedValue([0.1, 0.2]),
  } as unknown as EmbeddingService;

  return {
    fusion: new SearchFusion(vectorStore, bm25Index, embeddingService),
    vectorStore,
    bm25Index,
    embeddingService,
  };
};

describe('SearchFusion', () => {
  it('prioritizes content vector and indexes aggregating', async () => {
    const docA = createVectorDoc('c1', '/project/docs/a.md');
    const docB = createVectorDoc('c2', '/project/docs/a.md', '');
    const { fusion, vectorStore, bm25Index, embeddingService } = createFusion({
      contentResults: [createVectorResult(docA), createVectorResult(docB)],
    });

    const response = await fusion.search(
      { query: 'hello', scope: '/project/docs', topK: 2 },
      { useContentVector: true, useBM25: false }
    );

    expect(embeddingService.embed).toHaveBeenCalledOnce();
    expect(vectorStore.searchByContent).toHaveBeenCalledOnce();
    expect(bm25Index.search).not.toHaveBeenCalled();
    expect(response.results[0].chunkHits).toBeGreaterThanOrEqual(1);
    expect(response.results[0].source.filePath).toBe('/project/docs/a.md');
    expect(response.results[0].source.locator).toBe('loc-c1');
  });

  it('uses BM25 when requested without embeddings', async () => {
    const bm25Doc = createBm25Doc('b1', '/project/b1.md');
    const vectorDoc = createVectorDoc('b1', '/project/b1.md', 'loc-b1');
    const { fusion, vectorStore, bm25Index, embeddingService } = createFusion({
      bm25Results: [createBm25Result(bm25Doc)],
      getByChunkIdsResults: [vectorDoc],
    });

    const response = await fusion.search(
      { query: 'hi', keyword: 'hi keyword', scope: '/project', topK: 1 },
      { useContentVector: false, useBM25: true }
    );

    expect(embeddingService.embed).not.toHaveBeenCalled();
    expect(bm25Index.search).toHaveBeenCalled();
    expect(vectorStore.searchByContent).not.toHaveBeenCalled();
    expect(vectorStore.getByChunkIds).toHaveBeenCalledWith(['b1']);
    expect(response.results[0].source.locator).toBe('loc-b1');
  });
});

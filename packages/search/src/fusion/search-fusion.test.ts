import { describe, it, expect, vi } from 'vitest';
import { SearchFusion } from './search-fusion';
import type { VectorDocument, VectorSearchResult, BM25Document, BM25SearchResult } from '@agent-fs/core';
import type { VectorStore } from '../vector-store';
import type { BM25Index } from '../bm25';
import type { EmbeddingService } from '@agent-fs/llm';

const createVectorDoc = (
  id: string,
  filePath: string,
  locator: string = `loc-${id}`
): VectorDocument => {
  return {
    chunk_id: id,
    file_id: `file_${id}`,
    dir_id: 'dir1',
    rel_path: filePath.split('/').pop() ?? '',
    file_path: filePath,
    chunk_line_start: 1,
    chunk_line_end: 1,
    content_vector: [0, 0],
    summary_vector: [0, 0],
    locator,
    indexed_at: '2025-02-02T00:00:00.000Z',
    deleted_at: '',
  };
};

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
  summaryResults?: VectorSearchResult[];
  bm25Results?: BM25SearchResult[];
  getByChunkIdsResults?: VectorDocument[];
} = {}) => {
  const {
    contentResults = [],
    summaryResults = [],
    bm25Results = [],
    getByChunkIdsResults = [],
  } = options;

  const vectorStore = {
    searchByContent: vi.fn().mockResolvedValue(contentResults),
    searchBySummary: vi.fn().mockResolvedValue(summaryResults),
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
  it('should search with content vector only', async () => {
    const doc1 = createVectorDoc('c1', '/project/a.md');
    const doc2 = createVectorDoc('c2', '/project/b.md');
    const { fusion, vectorStore, bm25Index, embeddingService } = createFusion({
      contentResults: [createVectorResult(doc1), createVectorResult(doc2)],
    });

    const response = await fusion.search(
      { query: 'hello', scope: '/project', topK: 2 },
      { useContentVector: true, useSummaryVector: false, useBM25: false }
    );

    expect(embeddingService.embed).toHaveBeenCalledTimes(1);
    expect(vectorStore.searchByContent).toHaveBeenCalledTimes(1);
    expect(vectorStore.searchBySummary).not.toHaveBeenCalled();
    expect(bm25Index.search).not.toHaveBeenCalled();

    const args = (vectorStore.searchByContent as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0];
    expect(args[1]).toMatchObject({ topK: 4, filePathPrefix: '/project' });

    expect(response.results).toHaveLength(2);
    expect(response.results[0].chunkId).toBe('c1');
    expect(response.results[0].summary).toBe('');
    expect(response.results[0].source.locator).toBe('loc-c1');
  });

  it('should search with summary vector only', async () => {
    const doc1 = createVectorDoc('s1', '/project/s1.md');
    const { fusion, vectorStore, bm25Index, embeddingService } = createFusion({
      summaryResults: [createVectorResult(doc1)],
    });

    const response = await fusion.search(
      { query: 'hello', scope: '/project', topK: 1 },
      { useContentVector: false, useSummaryVector: true, useBM25: false }
    );

    expect(embeddingService.embed).toHaveBeenCalledTimes(1);
    expect(vectorStore.searchBySummary).toHaveBeenCalledTimes(1);
    expect(vectorStore.searchByContent).not.toHaveBeenCalled();
    expect(bm25Index.search).not.toHaveBeenCalled();

    expect(response.results).toHaveLength(1);
    expect(response.results[0].chunkId).toBe('s1');
  });

  it('should use keyword for bm25 and fill missing locator via getByChunkIds', async () => {
    const bm25Doc1 = createBm25Doc('b1', '/project/b1.md');
    const bm25Doc2 = createBm25Doc('b2', '/project/b2.md');
    const vectorDoc1 = createVectorDoc('b1', '/project/b1.md');
    const vectorDoc2 = createVectorDoc('b2', '/project/b2.md');

    const { fusion, vectorStore, bm25Index, embeddingService } = createFusion({
      bm25Results: [createBm25Result(bm25Doc1), createBm25Result(bm25Doc2)],
      getByChunkIdsResults: [vectorDoc1, vectorDoc2],
    });

    const response = await fusion.search(
      { query: 'query', keyword: 'keyword', scope: '/project', topK: 2 },
      { useContentVector: false, useSummaryVector: false, useBM25: true }
    );

    expect(embeddingService.embed).not.toHaveBeenCalled();
    expect(bm25Index.search).toHaveBeenCalledWith('keyword', {
      topK: 4,
      filePathPrefix: '/project',
    });
    expect(vectorStore.getByChunkIds).toHaveBeenCalledWith(['b1', 'b2']);

    expect(response.results).toHaveLength(2);
    expect(response.results[0].summary).toBe('');
    expect(response.results[0].source.locator).not.toBe('');
  });

  it('should use all sources, apply topK, and report meta', async () => {
    const contentDoc = createVectorDoc('c1', '/project/docs/c1.md');
    const summaryDoc = createVectorDoc('s1', '/project/docs/s1.md');
    const bm25Doc = createBm25Doc('b1', '/project/docs/b1.md');

    const { fusion, vectorStore, bm25Index, embeddingService } = createFusion({
      contentResults: [createVectorResult(contentDoc)],
      summaryResults: [createVectorResult(summaryDoc)],
      bm25Results: [createBm25Result(bm25Doc)],
      getByChunkIdsResults: [createVectorDoc('b1', '/project/docs/b1.md')],
    });

    const response = await fusion.search(
      { query: 'hello', scope: ['/project/docs', '/other'], topK: 1 },
      { useContentVector: true, useSummaryVector: true, useBM25: true }
    );

    expect(embeddingService.embed).toHaveBeenCalledTimes(1);
    expect(vectorStore.searchByContent).toHaveBeenCalledWith([0.1, 0.2], {
      topK: 2,
      filePathPrefix: '/project/docs',
    });
    expect(vectorStore.searchBySummary).toHaveBeenCalledWith([0.1, 0.2], {
      topK: 2,
      filePathPrefix: '/project/docs',
    });
    expect(bm25Index.search).toHaveBeenCalledWith('hello', {
      topK: 2,
      filePathPrefix: '/project/docs',
    });

    expect(response.results).toHaveLength(1);
    expect(response.meta.totalSearched).toBe(3);
    expect(response.meta.fusionMethod).toBe('rrf');
    expect(typeof response.meta.elapsedMs).toBe('number');
  });

  it('should merge bm25 results with vector fields without extra lookup', async () => {
    const sharedDoc = createVectorDoc('x1', '/project/x1.md', 'loc-x1');
    const bm25Doc = createBm25Doc('x1', '/project/x1.md');

    const { fusion, vectorStore } = createFusion({
      contentResults: [createVectorResult(sharedDoc)],
      bm25Results: [createBm25Result(bm25Doc)],
    });

    const response = await fusion.search(
      { query: 'hello', scope: '/project', topK: 1 },
      { useContentVector: true, useSummaryVector: false, useBM25: true }
    );

    expect(response.results[0].summary).toBe('');
    expect(response.results[0].source.locator).toBe('loc-x1');
    expect(vectorStore.getByChunkIds).not.toHaveBeenCalled();
  });

  it('should aggregate same-file chunks and boost score', async () => {
    const docA1 = createVectorDoc('a:0000', '/project/a.md', 'loc-a1');
    const docA2 = createVectorDoc('a:0001', '/project/a.md', 'loc-a2');
    const docB1 = createVectorDoc('b:0000', '/project/b.md', 'loc-b1');
    const { fusion } = createFusion({
      contentResults: [
        createVectorResult(docA1, 0.99),
        createVectorResult(docA2, 0.95),
        createVectorResult(docB1, 0.90),
      ],
    });

    const response = await fusion.search(
      { query: 'hello', scope: '/project', topK: 2 },
      { useContentVector: true, useSummaryVector: false, useBM25: false }
    );

    expect(response.results).toHaveLength(2);
    expect(response.results[0].chunkId).toBe('a:0000');
    expect(response.results[1].chunkId).toBe('b:0000');
    expect(response.results[0].chunkHits).toBe(2);
    expect(response.results[0].aggregatedChunkIds).toEqual(['a:0000', 'a:0001']);
    expect(new Set(response.results.map((item) => item.source.filePath)).size).toBe(2);
  });
});

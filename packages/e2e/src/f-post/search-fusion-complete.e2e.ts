import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MarkdownPlugin } from '@agent-fs/plugin-markdown';
import { MarkdownChunker } from '@agent-fs/core';
import { VectorStore, BM25Index, createSearchFusion } from '@agent-fs/search';
import type { VectorDocument, BM25Document } from '@agent-fs/core';
import type { EmbeddingService } from '@agent-fs/llm';
import { TEST_FILES } from '../utils/test-config';
import { createTempTestDir, cleanupTempDir, copyTestFile } from '../utils/test-helpers';

describe('F-Post: SearchFusion Complete Integration', () => {
  let tempDir: string;
  let storageDir: string;
  let plugin: MarkdownPlugin;
  let vectorStore: VectorStore;
  let bm25Index: BM25Index;

  const DIMENSION = 8;

  function mockVector(content: string): number[] {
    const vector = new Array(DIMENSION).fill(0);
    for (let i = 0; i < content.length && i < DIMENSION * 10; i++) {
      vector[i % DIMENSION] += content.charCodeAt(i) / 1000;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return vector.map((v) => v / (norm || 1));
  }

  const mockEmbeddingService: EmbeddingService = {
    embed: async (text: string) => mockVector(text),
    embedBatch: async (texts: string[]) => texts.map(mockVector),
    getDimension: () => DIMENSION,
    init: async () => {},
    dispose: async () => {},
  };

  beforeEach(async () => {
    tempDir = createTempTestDir();
    storageDir = createTempTestDir();
    plugin = new MarkdownPlugin();
    vectorStore = new VectorStore({
      storagePath: storageDir,
      dimension: DIMENSION,
    });
    await vectorStore.init();
    bm25Index = new BM25Index();
  });

  afterEach(async () => {
    await vectorStore.close();
    cleanupTempDir(tempDir);
    cleanupTempDir(storageDir);
  });

  it('should perform complete SearchFusion.search() with mock embedding', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunks = chunker.chunk(result.markdown);

    const vectorDocs: VectorDocument[] = [];
    const bm25Docs: BM25Document[] = [];

    for (let i = 0; i < Math.min(chunks.length, 10); i++) {
      const chunk = chunks[i];
      const chunkId = `search-fusion-${i}`;

      vectorDocs.push({
        chunk_id: chunkId,
        file_id: 'sf-file-001',
        dir_id: 'sf-dir-001',
        rel_path: TEST_FILES.markdown,
        file_path: filePath,
        content: chunk.content,
        summary: `摘要 ${i}: ${chunk.content.slice(0, 30)}`,
        content_vector: mockVector(chunk.content),
        summary_vector: mockVector(`摘要 ${i}`),
        locator: chunk.locator,
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      });

      bm25Docs.push({
        chunk_id: chunkId,
        file_id: 'sf-file-001',
        dir_id: 'sf-dir-001',
        file_path: filePath,
        content: chunk.content,
        tokens: [],
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      });
    }

    await vectorStore.addDocuments(vectorDocs);
    bm25Index.addDocuments(bm25Docs);

    const fusion = createSearchFusion(vectorStore, bm25Index, mockEmbeddingService);

    const response = await fusion.search({
      query: 'INSPECTION REPORT CONFORMED',
      topK: 5,
    });

    expect(response.results.length).toBeGreaterThan(0);
    expect(response.results.length).toBeLessThanOrEqual(5);
    expect(response.meta.fusionMethod).toBe('rrf');
    expect(response.meta.totalSearched).toBeGreaterThan(0);
    expect(response.meta.elapsedMs).toBeGreaterThanOrEqual(0);

    for (const resultItem of response.results) {
      expect(resultItem.chunkId).toBeDefined();
      expect(resultItem.score).toBeGreaterThan(0);
      expect(resultItem.content).toBeDefined();
      expect(resultItem.source.filePath).toBeDefined();
    }
  });

  it('should use keyword for BM25 when provided', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunks = chunker.chunk(result.markdown);

    const bm25Docs: BM25Document[] = chunks.slice(0, 5).map((chunk, i) => ({
      chunk_id: `keyword-test-${i}`,
      file_id: 'file-001',
      dir_id: 'dir-001',
      file_path: filePath,
      content: chunk.content,
      tokens: [],
      indexed_at: new Date().toISOString(),
      deleted_at: '',
    }));

    bm25Index.addDocuments(bm25Docs);

    const fusion = createSearchFusion(vectorStore, bm25Index, mockEmbeddingService);

    const response = await fusion.search(
      {
        query: 'semantic query for vectors',
        keyword: 'INSPECTION REPORT',
        topK: 5,
      },
      {
        useContentVector: false,
        useSummaryVector: false,
        useBM25: true,
      }
    );

    expect(response.results.length).toBeGreaterThan(0);
  });

  it('should backfill summary/locator for BM25-only results', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunks = chunker.chunk(result.markdown);

    const vectorDocs: VectorDocument[] = chunks.slice(0, 3).map((chunk, i) => ({
      chunk_id: `backfill-test-${i}`,
      file_id: 'file-001',
      dir_id: 'dir-001',
      rel_path: TEST_FILES.markdown,
      file_path: filePath,
      content: chunk.content,
      summary: `完整摘要 ${i}`,
      content_vector: mockVector(chunk.content),
      summary_vector: mockVector(`摘要 ${i}`),
      locator: chunk.locator,
      indexed_at: new Date().toISOString(),
      deleted_at: '',
    }));

    const bm25Docs: BM25Document[] = chunks.slice(0, 3).map((chunk, i) => ({
      chunk_id: `backfill-test-${i}`,
      file_id: 'file-001',
      dir_id: 'dir-001',
      file_path: filePath,
      content: chunk.content,
      tokens: [],
      indexed_at: new Date().toISOString(),
      deleted_at: '',
    }));

    await vectorStore.addDocuments(vectorDocs);
    bm25Index.addDocuments(bm25Docs);

    const fusion = createSearchFusion(vectorStore, bm25Index, mockEmbeddingService);

    const response = await fusion.search(
      { query: 'INSPECTION', topK: 3 },
      { useContentVector: false, useSummaryVector: false, useBM25: true }
    );

    for (const resultItem of response.results) {
      expect(resultItem.summary).toContain('完整摘要');
      expect(resultItem.source.locator).toBeDefined();
      expect(resultItem.source.locator.length).toBeGreaterThan(0);
    }
  });
});

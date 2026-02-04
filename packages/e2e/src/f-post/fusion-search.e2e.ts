import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MarkdownPlugin } from '@agent-fs/plugin-markdown';
import { MarkdownChunker } from '@agent-fs/core';
import { VectorStore, BM25Index, fusionRRF } from '../../../search/src';
import type { VectorDocument, BM25Document } from '@agent-fs/core';
import { TEST_FILES } from '../utils/test-config';
import { createTempTestDir, cleanupTempDir, copyTestFile } from '../utils/test-helpers';

describe('F-Post: Fusion Search Integration', () => {
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

  it('should fuse vector and BM25 results using RRF', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunks = chunker.chunk(result.markdown);

    const vectorDocs: VectorDocument[] = [];
    const bm25Docs: BM25Document[] = [];

    for (let i = 0; i < Math.min(chunks.length, 10); i++) {
      const chunk = chunks[i];
      const chunkId = `fusion-test-${i}`;

      vectorDocs.push({
        chunk_id: chunkId,
        file_id: 'fusion-file-001',
        dir_id: 'fusion-dir-001',
        rel_path: TEST_FILES.markdown,
        file_path: filePath,
        content: chunk.content,
        summary: `摘要 ${i}`,
        content_vector: mockVector(chunk.content),
        summary_vector: mockVector(`摘要 ${i}`),
        locator: chunk.locator,
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      });

      bm25Docs.push({
        chunk_id: chunkId,
        file_id: 'fusion-file-001',
        dir_id: 'fusion-dir-001',
        file_path: filePath,
        content: chunk.content,
        tokens: [],
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      });
    }

    await vectorStore.addDocuments(vectorDocs);
    bm25Index.addDocuments(bm25Docs);

    const queryVector = mockVector('Report CONFORMED');
    const vectorResults = await vectorStore.searchByContent(queryVector, { topK: 5 });
    const bm25Results = bm25Index.search('CONFORMED', { topK: 5 });

    const fused = fusionRRF(
      [
        {
          name: 'vector',
          items: vectorResults.map((r) => ({
            chunkId: r.chunk_id,
            score: r.score,
            content: r.document.content,
          })),
        },
        {
          name: 'bm25',
          items: bm25Results.map((r) => ({
            chunkId: r.chunk_id,
            score: r.score,
            content: r.document.content,
          })),
        },
      ],
      (item) => item.chunkId
    );

    expect(fused.length).toBeGreaterThan(0);

    for (const result of fused) {
      expect(result.score).toBeGreaterThan(0);
      expect(result.sources.length).toBeGreaterThanOrEqual(1);
    }

    const multiSourceItems = fused.filter((r) => r.sources.length > 1);
    const singleSourceItems = fused.filter((r) => r.sources.length === 1);

    if (multiSourceItems.length > 0 && singleSourceItems.length > 0) {
      expect(multiSourceItems[0].score).toBeGreaterThanOrEqual(singleSourceItems[0].score);
    }
  });

  it('should handle empty results from one source', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunks = chunker.chunk(result.markdown);

    const bm25Docs: BM25Document[] = chunks.slice(0, 3).map((chunk, i) => ({
      chunk_id: `empty-test-${i}`,
      file_id: 'file-001',
      dir_id: 'dir-001',
      file_path: filePath,
      content: chunk.content,
      tokens: [],
      indexed_at: new Date().toISOString(),
      deleted_at: '',
    }));

    bm25Index.addDocuments(bm25Docs);

    const bm25Results = bm25Index.search('CONFORMED', { topK: 5 });

    const fused = fusionRRF(
      [
        { name: 'vector', items: [] },
        {
          name: 'bm25',
          items: bm25Results.map((r) => ({
            chunkId: r.chunk_id,
            score: r.score,
          })),
        },
      ],
      (item) => item.chunkId
    );

    expect(fused.length).toBe(bm25Results.length);
    for (const resultItem of fused) {
      expect(resultItem.sources).toContain('bm25');
      expect(resultItem.sources).not.toContain('vector');
    }
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { MarkdownPlugin } from '@agent-fs/plugin-markdown';
import { MarkdownChunker } from '@agent-fs/core';
import { createEmbeddingService, createSummaryService } from '@agent-fs/llm';
import { VectorStore, BM25Index, fusionRRF } from '../../../search/src';
import type { VectorDocument, BM25Document } from '@agent-fs/core';
import { TEST_FILES, MOCK_CONFIG, checkLLMAvailable } from '../utils/test-config';
import { createTempTestDir, cleanupTempDir, copyTestFile } from '../utils/test-helpers';

describe('F-Post: Full Indexing Pipeline', () => {
  let llmAvailable: boolean;

  beforeAll(async () => {
    llmAvailable = await checkLLMAvailable();
    if (!llmAvailable) {
      console.warn('⚠️ LLM service not available. Skipping full pipeline tests.');
    }
  });

  describe('with LLM service', () => {
    let tempDir: string;
    let storageDir: string;

    beforeEach(() => {
      tempDir = createTempTestDir();
      storageDir = createTempTestDir();
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
      cleanupTempDir(storageDir);
    });

    it('should complete full indexing pipeline for markdown', async () => {
      if (!llmAvailable) {
        console.log('Skipping: LLM service not available');
        return;
      }

      const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

      const embeddingService = createEmbeddingService(MOCK_CONFIG.embedding);
      await embeddingService.init();

      const summaryService = createSummaryService(MOCK_CONFIG.llm);

      const dimension = embeddingService.getDimension();
      const vectorStore = new VectorStore({
        storagePath: storageDir,
        dimension,
      });
      await vectorStore.init();

      const bm25Index = new BM25Index();

      try {
        const plugin = new MarkdownPlugin();
        const conversionResult = await plugin.toMarkdown(filePath);

        const chunker = new MarkdownChunker({
          minTokens: MOCK_CONFIG.indexing.chunkSize.minTokens,
          maxTokens: MOCK_CONFIG.indexing.chunkSize.maxTokens,
        });
        const chunks = chunker.chunk(conversionResult.markdown);

        expect(chunks.length).toBeGreaterThan(0);

        const vectorDocs: VectorDocument[] = [];
        const bm25Docs: BM25Document[] = [];

        for (let i = 0; i < Math.min(chunks.length, 3); i++) {
          const chunk = chunks[i];
          const chunkId = `full-pipeline-${i}`;

          const summaryResult = await summaryService.generateChunkSummary(chunk.content);
          expect(summaryResult.summary).toBeDefined();
          expect(summaryResult.summary.length).toBeGreaterThan(0);

          const contentVector = await embeddingService.embed(chunk.content);
          const summaryVector = await embeddingService.embed(summaryResult.summary);

          expect(contentVector.length).toBe(dimension);
          expect(summaryVector.length).toBe(dimension);

          vectorDocs.push({
            chunk_id: chunkId,
            file_id: 'pipeline-file-001',
            dir_id: 'pipeline-dir-001',
            rel_path: TEST_FILES.markdown,
            file_path: filePath,
            content: chunk.content,
            summary: summaryResult.summary,
            content_vector: contentVector,
            summary_vector: summaryVector,
            locator: chunk.locator,
            indexed_at: new Date().toISOString(),
            deleted_at: '',
          });

          bm25Docs.push({
            chunk_id: chunkId,
            file_id: 'pipeline-file-001',
            dir_id: 'pipeline-dir-001',
            file_path: filePath,
            content: chunk.content,
            tokens: [],
            indexed_at: new Date().toISOString(),
            deleted_at: '',
          });
        }

        await vectorStore.addDocuments(vectorDocs);
        bm25Index.addDocuments(bm25Docs);

        const queryVector = await embeddingService.embed('Report CONFORMED');

        const vectorResults = await vectorStore.searchByContent(queryVector, { topK: 3 });
        const bm25Results = bm25Index.search('CONFORMED', { topK: 3 });

        expect(vectorResults.length).toBeGreaterThan(0);
        expect(bm25Results.length).toBeGreaterThan(0);

        const fused = fusionRRF(
          [
            {
              name: 'vector',
              items: vectorResults.map((r) => ({ chunkId: r.chunk_id, score: r.score })),
            },
            {
              name: 'bm25',
              items: bm25Results.map((r) => ({ chunkId: r.chunk_id, score: r.score })),
            },
          ],
          (item) => item.chunkId
        );

        expect(fused.length).toBeGreaterThan(0);

        console.log('✅ Full pipeline completed successfully');
        console.log(`   - Chunks processed: ${vectorDocs.length}`);
        console.log(`   - Vector search results: ${vectorResults.length}`);
        console.log(`   - BM25 search results: ${bm25Results.length}`);
        console.log(`   - Fused results: ${fused.length}`);
      } finally {
        await vectorStore.close();
        await embeddingService.dispose();
      }
    }, 180000);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MarkdownPlugin } from '@agent-fs/plugin-markdown';
import { MarkdownChunker } from '@agent-fs/core';
import { BM25Index } from '@agent-fs/search';
import type { BM25Document } from '@agent-fs/core';
import { TEST_FILES } from '../utils/test-config';
import { createTempTestDir, cleanupTempDir, copyTestFile } from '../utils/test-helpers';

describe('F-Post: BM25 Search Integration', () => {
  let tempDir: string;
  let plugin: MarkdownPlugin;
  let index: BM25Index;

  beforeEach(() => {
    tempDir = createTempTestDir();
    plugin = new MarkdownPlugin();
    index = new BM25Index();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should index and search markdown content', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunks = chunker.chunk(result.markdown);

    const docs: BM25Document[] = chunks.map((chunk, i) => ({
      chunk_id: `test-chunk-${i}`,
      file_id: 'test-file-001',
      dir_id: 'test-dir-001',
      file_path: filePath,
      content: chunk.content,
      tokens: [],
      indexed_at: new Date().toISOString(),
      deleted_at: '',
    }));

    index.addDocuments(docs);

    const results1 = index.search('CONFORMED', { topK: 5 });
    expect(results1.length).toBeGreaterThan(0);
    expect(results1[0].score).toBeGreaterThan(0);

    const results2 = index.search('SMART SPEAKER', { topK: 5 });
    expect(results2.length).toBeGreaterThan(0);

    const results3 = index.search('Report', { topK: 5 });
    expect(results3.length).toBeGreaterThan(0);
  });

  it('should handle soft delete correctly', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunks = chunker.chunk(result.markdown);

    const docs: BM25Document[] = chunks.slice(0, 3).map((chunk, i) => ({
      chunk_id: `delete-test-${i}`,
      file_id: 'test-file-001',
      dir_id: 'test-dir-001',
      file_path: filePath,
      content: chunk.content,
      tokens: [],
      indexed_at: new Date().toISOString(),
      deleted_at: '',
    }));

    index.addDocuments(docs);
    index.softDelete('delete-test-0');

    const afterDelete = index.search('CONFORMED', { topK: 10 });
    expect(afterDelete.find((r) => r.chunk_id === 'delete-test-0')).toBeUndefined();
  });

  it('should filter by filePathPrefix', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunks = chunker.chunk(result.markdown);

    const docs: BM25Document[] = [
      {
        chunk_id: 'path-test-1',
        file_id: 'file-001',
        dir_id: 'dir-001',
        file_path: '/project/docs/report.md',
        content: chunks[0]?.content || 'report content alpha',
        tokens: [],
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      },
      {
        chunk_id: 'path-test-2',
        file_id: 'file-002',
        dir_id: 'dir-001',
        file_path: '/project/other/data.md',
        content: chunks[1]?.content || 'report content beta',
        tokens: [],
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      },
    ];

    index.addDocuments(docs);

    const filtered = index.search('report', {
      topK: 10,
      filePathPrefix: '/project/docs',
    });

    expect(filtered.length).toBe(1);
    expect(filtered[0].chunk_id).toBe('path-test-1');
  });
});

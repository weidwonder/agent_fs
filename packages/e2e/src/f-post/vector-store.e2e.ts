import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MarkdownPlugin } from '@agent-fs/plugin-markdown';
import { MarkdownChunker } from '@agent-fs/core';
import { VectorStore } from '@agent-fs/search';
import type { VectorDocument } from '@agent-fs/core';
import { TEST_FILES } from '../utils/test-config';
import { createTempTestDir, cleanupTempDir, copyTestFile } from '../utils/test-helpers';

describe('F-Post: Vector Store Integration', () => {
  let tempDir: string;
  let storageDir: string;
  let plugin: MarkdownPlugin;
  let store: VectorStore;

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
    store = new VectorStore({
      storagePath: storageDir,
      dimension: DIMENSION,
    });
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    cleanupTempDir(tempDir);
    cleanupTempDir(storageDir);
  });

  it('should store and search vectors from markdown content', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunks = chunker.chunk(result.markdown);

    const docs: VectorDocument[] = chunks.slice(0, 5).map((chunk, i) => ({
      chunk_id: `vec-test-${i}`,
      file_id: 'vec-file-001',
      dir_id: 'vec-dir-001',
      rel_path: TEST_FILES.markdown,
      file_path: filePath,
      content: chunk.content,
      summary: `摘要 ${i}: ${chunk.content.slice(0, 50)}`,
      content_vector: mockVector(chunk.content),
      summary_vector: mockVector(`摘要 ${i}`),
      locator: chunk.locator,
      indexed_at: new Date().toISOString(),
      deleted_at: '',
    }));

    await store.addDocuments(docs);

    const count = await store.countRows();
    expect(count).toBe(5);

    const queryVector = mockVector(chunks[0].content);
    const results = await store.searchByContent(queryVector, { topK: 3 });

    expect(results.length).toBe(3);
    expect(results[0].chunk_id).toBe('vec-test-0');
    expect(results[0].score).toBeGreaterThan(0.9);
  });

  it('should filter by dirId', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunks = chunker.chunk(result.markdown);

    const docs: VectorDocument[] = [
      {
        chunk_id: 'dir-test-1',
        file_id: 'file-001',
        dir_id: 'dir-alpha',
        rel_path: 'a.md',
        file_path: '/alpha/a.md',
        content: chunks[0]?.content || 'content alpha',
        summary: 'summary alpha',
        content_vector: mockVector('content alpha'),
        summary_vector: mockVector('summary alpha'),
        locator: 'line:1-10',
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      },
      {
        chunk_id: 'dir-test-2',
        file_id: 'file-002',
        dir_id: 'dir-beta',
        rel_path: 'b.md',
        file_path: '/beta/b.md',
        content: chunks[1]?.content || 'content beta',
        summary: 'summary beta',
        content_vector: mockVector('content beta'),
        summary_vector: mockVector('summary beta'),
        locator: 'line:1-10',
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      },
    ];

    await store.addDocuments(docs);

    const filtered = await store.searchByContent(mockVector('content'), {
      topK: 10,
      dirId: 'dir-alpha',
    });

    expect(filtered.length).toBe(1);
    expect(filtered[0].document.dir_id).toBe('dir-alpha');
  });

  it('should handle soft delete and compact', async () => {
    const docs: VectorDocument[] = [
      {
        chunk_id: 'compact-test-1',
        file_id: 'file-001',
        dir_id: 'dir-001',
        rel_path: 'a.md',
        file_path: '/a.md',
        content: 'content 1',
        summary: 'summary 1',
        content_vector: mockVector('content 1'),
        summary_vector: mockVector('summary 1'),
        locator: 'line:1',
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      },
      {
        chunk_id: 'compact-test-2',
        file_id: 'file-002',
        dir_id: 'dir-001',
        rel_path: 'b.md',
        file_path: '/b.md',
        content: 'content 2',
        summary: 'summary 2',
        content_vector: mockVector('content 2'),
        summary_vector: mockVector('summary 2'),
        locator: 'line:1',
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      },
    ];

    await store.addDocuments(docs);
    await store.softDelete(['compact-test-1']);

    const results = await store.searchByContent(mockVector('content'), { topK: 10 });
    expect(results.find((r) => r.chunk_id === 'compact-test-1')).toBeUndefined();

    const withDeleted = await store.searchByContent(mockVector('content'), {
      topK: 10,
      includeDeleted: true,
    });
    expect(withDeleted.find((r) => r.chunk_id === 'compact-test-1')).toBeDefined();

    const removed = await store.compact();
    expect(removed).toBe(1);
  });
});

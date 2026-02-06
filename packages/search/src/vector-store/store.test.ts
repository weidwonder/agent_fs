import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VectorStore } from './store';
import type { VectorDocument } from '@agent-fs/core';

describe('VectorStore', () => {
  const dimension = 3;
  let store: VectorStore;
  let testDir: string;

  const createDoc = (
    id: string,
    dirId: string,
    filePath: string,
    contentVector: number[],
    summaryVector: number[]
  ): VectorDocument => ({
    chunk_id: id,
    file_id: `file_${id}`,
    dir_id: dirId,
    rel_path: filePath.split('/').pop() ?? '',
    file_path: filePath,
    chunk_line_start: 1,
    chunk_line_end: 3,
    content_vector: contentVector,
    summary_vector: summaryVector,
    locator: `line:${id}`,
    indexed_at: new Date().toISOString(),
    deleted_at: '',
  });

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `vector-store-test-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
    store = new VectorStore({ storagePath: testDir, dimension });
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should initialize empty table', async () => {
    const count = await store.countRows();
    expect(count).toBe(0);
  });

  it('should add documents and search by content', async () => {
    const docs = [
      createDoc('c1', 'dir1', '/project/docs/a.md', [1, 0, 0], [0, 1, 0]),
      createDoc('c2', 'dir1', '/project/docs/b.md', [0, 1, 0], [1, 0, 0]),
    ];

    await store.addDocuments(docs);

    const results = await store.searchByContent([1, 0, 0], { topK: 1 });
    expect(results.length).toBe(1);
    expect(results[0].chunk_id).toBe('c1');
    expect(results[0].document.chunk_line_start).toBe(1);
    expect(results[0].document.chunk_line_end).toBe(3);
  });

  it('should search by summary', async () => {
    const docs = [
      createDoc('s1', 'dir1', '/project/docs/s1.md', [1, 0, 0], [0, 1, 0]),
      createDoc('s2', 'dir1', '/project/docs/s2.md', [0, 1, 0], [0, 0, 1]),
    ];

    await store.addDocuments(docs);

    const results = await store.searchBySummary([0, 1, 0], { topK: 1 });
    expect(results.length).toBe(1);
    expect(results[0].chunk_id).toBe('s1');
  });

  it('should filter by dirId', async () => {
    const docs = [
      createDoc('d1', 'dir1', '/project/docs/d1.md', [1, 0, 0], [0, 1, 0]),
      createDoc('d2', 'dir2', '/project/docs/d2.md', [1, 0, 0], [0, 1, 0]),
    ];

    await store.addDocuments(docs);

    const results = await store.searchByContent([1, 0, 0], {
      topK: 10,
      dirId: 'dir1',
    });

    expect(results.length).toBe(1);
    expect(results[0].document.dir_id).toBe('dir1');
  });

  it('should filter by filePathPrefix', async () => {
    const docs = [
      createDoc('p1', 'dir1', '/project/docs/p1.md', [1, 0, 0], [0, 1, 0]),
      createDoc('p2', 'dir1', '/project/other/p2.md', [1, 0, 0], [0, 1, 0]),
    ];

    await store.addDocuments(docs);

    const results = await store.searchByContent([1, 0, 0], {
      topK: 10,
      filePathPrefix: '/project/docs',
    });

    expect(results.length).toBe(1);
    expect(results[0].document.file_path).toBe('/project/docs/p1.md');
  });

  it('should soft delete documents', async () => {
    const docs = [
      createDoc('x1', 'dir1', '/project/docs/x1.md', [1, 0, 0], [0, 1, 0]),
      createDoc('x2', 'dir1', '/project/docs/x2.md', [0, 1, 0], [1, 0, 0]),
    ];

    await store.addDocuments(docs);
    await store.softDelete(['x1']);

    const results = await store.searchByContent([1, 0, 0], { topK: 10 });
    expect(results.some((item) => item.chunk_id === 'x1')).toBe(false);

    const withDeleted = await store.searchByContent([1, 0, 0], {
      topK: 10,
      includeDeleted: true,
    });
    expect(withDeleted.some((item) => item.chunk_id === 'x1')).toBe(true);
  });

  it('should delete by fileId', async () => {
    const docs = [
      createDoc('f1', 'dir1', '/project/docs/f1.md', [1, 0, 0], [0, 1, 0]),
      createDoc('f2', 'dir1', '/project/docs/f2.md', [0, 1, 0], [1, 0, 0]),
    ];

    await store.addDocuments(docs);
    const beforeCount = await store.countRows();

    await store.deleteByFileId('file_f1');
    const afterCount = await store.countRows();

    expect(beforeCount - afterCount).toBe(1);
  });

  it('should delete by dirId', async () => {
    const docs = [
      createDoc('g1', 'dir1', '/project/docs/g1.md', [1, 0, 0], [0, 1, 0]),
      createDoc('g2', 'dir2', '/project/docs/g2.md', [0, 1, 0], [1, 0, 0]),
    ];

    await store.addDocuments(docs);
    await store.deleteByDirId('dir1');

    const results = await store.searchByContent([1, 0, 0], {
      topK: 10,
      includeDeleted: true,
    });

    expect(results.some((item) => item.document.dir_id === 'dir1')).toBe(false);
  });

  it('should compact deleted documents', async () => {
    const docs = [
      createDoc('cpt1', 'dir1', '/project/docs/cpt1.md', [1, 0, 0], [0, 1, 0]),
      createDoc('cpt2', 'dir1', '/project/docs/cpt2.md', [0, 1, 0], [1, 0, 0]),
    ];

    await store.addDocuments(docs);
    await store.softDelete(['cpt1']);

    const removed = await store.compact();
    const count = await store.countRows();

    expect(removed).toBe(1);
    expect(count).toBe(1);
  });

  it('should get documents by chunk ids', async () => {
    const docs = [
      createDoc('g1', 'dir1', '/project/docs/g1.md', [1, 0, 0], [0, 1, 0]),
      createDoc('g2', 'dir1', '/project/docs/g2.md', [0, 1, 0], [1, 0, 0]),
      createDoc('g3', 'dir1', '/project/docs/g3.md', [0, 0, 1], [1, 0, 0]),
    ];

    await store.addDocuments(docs);

    const results = await store.getByChunkIds(['g1', 'g3']);
    const ids = results.map((doc) => doc.chunk_id).sort();

    expect(ids).toEqual(['g1', 'g3']);
  });

  it('should not return soft deleted documents', async () => {
    const docs = [
      createDoc('d1', 'dir1', '/project/docs/d1.md', [1, 0, 0], [0, 1, 0]),
      createDoc('d2', 'dir1', '/project/docs/d2.md', [0, 1, 0], [1, 0, 0]),
    ];

    await store.addDocuments(docs);
    await store.softDelete(['d2']);

    const results = await store.getByChunkIds(['d1', 'd2']);
    const ids = results.map((doc) => doc.chunk_id).sort();

    expect(ids).toEqual(['d1']);
  });
});

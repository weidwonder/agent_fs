import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as lancedb from '@lancedb/lancedb';
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

  it('应在旧版 schema 时自动删表重建并可写入新文档', async () => {
    await store.close();
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    const db = await lancedb.connect(testDir);
    await db.createTable('chunks', [
      {
        chunk_id: 'legacy-1',
        file_id: 'legacy-file-1',
        dir_id: 'legacy-dir',
        rel_path: 'legacy.md',
        file_path: '/legacy.md',
        content: 'legacy content',
        summary: 'legacy summary',
        content_vector: [0, 0, 0],
        summary_vector: [0, 0, 0],
        locator: 'line:1',
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      },
    ]);

    store = new VectorStore({ storagePath: testDir, dimension });
    await store.init();

    await expect(
      store.addDocuments([createDoc('new-1', 'dir1', '/project/docs/new.md', [1, 0, 0], [0, 1, 0])])
    ).resolves.toBeUndefined();

    const results = await store.getByChunkIds(['new-1']);
    expect(results).toHaveLength(1);
    expect(results[0].chunk_line_start).toBe(1);
    expect(results[0].chunk_line_end).toBe(3);
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

  it('应按 content+summary 的 1:1 合并向量检索', async () => {
    const docs = [
      createDoc('h1', 'dir1', '/project/docs/h1.md', [1, 0, 0], [0, 1, 0]),
      createDoc('h2', 'dir1', '/project/docs/h2.md', [1, 0, 0], [0, 0, 1]),
    ];

    await store.addDocuments(docs);

    const results = await store.searchByHybrid([1, 1, 0], { topK: 1 });
    expect(results.length).toBe(1);
    expect(results[0].chunk_id).toBe('h1');
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

  it('should filter by multiple dirIds', async () => {
    const docs = [
      createDoc('m1', 'dir1', '/project/docs/m1.md', [1, 0, 0], [0, 1, 0]),
      createDoc('m2', 'dir2', '/project/docs/m2.md', [1, 0, 0], [0, 1, 0]),
      createDoc('m3', 'dir3', '/project/docs/m3.md', [1, 0, 0], [0, 1, 0]),
    ];

    await store.addDocuments(docs);

    const results = await store.searchByContent([1, 0, 0], {
      topK: 10,
      dirIds: ['dir1', 'dir2'],
    });

    expect(results).toHaveLength(2);
    expect(new Set(results.map((item) => item.document.dir_id))).toEqual(new Set(['dir1', 'dir2']));
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

  it('should delete by multiple dirIds', async () => {
    const docs = [
      createDoc('m1', 'dir1', '/project/docs/m1.md', [1, 0, 0], [0, 1, 0]),
      createDoc('m2', 'dir2', '/project/docs/m2.md', [0, 1, 0], [1, 0, 0]),
      createDoc('m3', 'dir3', '/project/docs/m3.md', [0, 0, 1], [1, 0, 0]),
    ];

    await store.addDocuments(docs);
    await store.deleteByDirIds(['dir1', 'dir3']);

    const results = await store.searchByContent([1, 0, 0], {
      topK: 10,
      includeDeleted: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].document.dir_id).toBe('dir2');
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

  it('应优先走 postfilter，不足时回退 prefilter', async () => {
    const fakeRow = {
      chunk_id: 'pf-1',
      _distance: 0.1,
      file_id: 'file_pf-1',
      dir_id: 'dir1',
      rel_path: 'pf.md',
      file_path: '/project/docs/pf.md',
      chunk_line_start: 2,
      chunk_line_end: 4,
      locator: 'line:2-4',
      indexed_at: new Date().toISOString(),
      deleted_at: '',
    };

    const postfilterToArray = vi.fn().mockResolvedValue([]);
    const prefilterToArray = vi.fn().mockResolvedValue([fakeRow]);
    const postfilter = vi.fn(() => ({ toArray: postfilterToArray }));
    const where = vi.fn(() => ({
      postfilter,
      toArray: prefilterToArray,
    }));
    const limit = vi.fn(() => ({ where }));
    const vectorSearch = vi.fn(() => ({
      column: vi.fn().mockReturnThis(),
      distanceType: vi.fn().mockReturnThis(),
      limit,
    }));

    const testStore = new VectorStore({ storagePath: testDir, dimension });
    (testStore as any).db = {};
    (testStore as any).table = { vectorSearch };

    const results = await testStore.searchByHybrid([1, 0, 0], {
      topK: 1,
      dirIds: ['dir1'],
    });

    expect(postfilter).toHaveBeenCalledTimes(1);
    expect(postfilterToArray).toHaveBeenCalledTimes(1);
    expect(prefilterToArray).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0].chunk_id).toBe('pf-1');
    await testStore.close();
  });

  it('postfilter 达到最小阈值时不应回退 prefilter', async () => {
    const postfilterRows = Array.from({ length: 18 }, (_, index) => ({
      chunk_id: `pf-threshold-${index}`,
      _distance: 0.1,
      file_id: `file_pf-threshold-${index}`,
      dir_id: 'dir1',
      rel_path: `pf-${index}.md`,
      file_path: `/project/docs/pf-${index}.md`,
      chunk_line_start: 2,
      chunk_line_end: 4,
      locator: 'line:2-4',
      indexed_at: new Date().toISOString(),
      deleted_at: '',
    }));

    const postfilterToArray = vi.fn().mockResolvedValue(postfilterRows);
    const prefilterToArray = vi.fn().mockResolvedValue([]);
    const postfilter = vi.fn(() => ({ toArray: postfilterToArray }));
    const where = vi.fn(() => ({
      postfilter,
      toArray: prefilterToArray,
    }));
    const limit = vi.fn(() => ({ where }));
    const vectorSearch = vi.fn(() => ({
      column: vi.fn().mockReturnThis(),
      distanceType: vi.fn().mockReturnThis(),
      limit,
    }));

    const testStore = new VectorStore({ storagePath: testDir, dimension });
    (testStore as any).db = {};
    (testStore as any).table = { vectorSearch };

    const results = await testStore.searchByHybrid([1, 0, 0], {
      topK: 30,
      dirIds: ['dir1'],
      minResultsBeforeFallback: 10,
    });

    expect(postfilter).toHaveBeenCalledTimes(1);
    expect(postfilterToArray).toHaveBeenCalledTimes(1);
    expect(prefilterToArray).not.toHaveBeenCalled();
    expect(results).toHaveLength(18);
    await testStore.close();
  });

  it('getByChunkIds 应使用标量查询路径而非向量检索', async () => {
    const queryToArray = vi.fn().mockResolvedValue([
      {
        chunk_id: 'q1',
        file_id: 'file_q1',
        dir_id: 'dir1',
        rel_path: 'q1.md',
        file_path: '/project/docs/q1.md',
        chunk_line_start: 1,
        chunk_line_end: 2,
        locator: 'line:1-2',
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      },
    ]);
    const queryBuilder = {
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: queryToArray,
    };
    const vectorSearch = vi.fn(() => {
      throw new Error('不应调用向量检索');
    });

    const testStore = new VectorStore({ storagePath: testDir, dimension });
    (testStore as any).db = {};
    (testStore as any).table = {
      query: vi.fn(() => queryBuilder),
      vectorSearch,
    };

    const results = await testStore.getByChunkIds(['q1']);

    expect(queryBuilder.where).toHaveBeenCalledTimes(1);
    expect(vectorSearch).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].chunk_id).toBe('q1');
    await testStore.close();
  });
});

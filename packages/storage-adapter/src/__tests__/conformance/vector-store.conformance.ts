import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import type { VectorDocument, VectorStoreAdapter } from '../../types.js';

function makeDoc(overrides: Partial<VectorDocument> = {}): VectorDocument {
  return {
    chunk_id: 'chunk-1',
    file_id: 'file-1',
    dir_id: 'dir-1',
    rel_path: 'doc.md',
    file_path: '/root/doc.md',
    chunk_line_start: 1,
    chunk_line_end: 10,
    content_vector: [0.1, 0.2, 0.3, 0.4],
    locator: 'L1',
    indexed_at: new Date().toISOString(),
    deleted_at: '',
    ...overrides,
  };
}

export function describeVectorStoreConformance(
  name: string,
  factory: () => Promise<VectorStoreAdapter>,
  teardown: () => Promise<void>,
): void {
  describe(`VectorStoreAdapter conformance: ${name}`, () => {
    let adapter: VectorStoreAdapter;

    beforeAll(async () => {
      adapter = await factory();
      await adapter.init();
    });

    afterAll(async () => {
      await adapter.close();
      await teardown();
    });

    it('addDocuments + searchByVector returns matching results', async () => {
      const doc = makeDoc({ chunk_id: 'vs-1', file_id: 'f-vs-1', dir_id: 'd-vs-1' });
      await adapter.addDocuments([doc]);

      const results = await adapter.searchByVector({
        vector: [0.1, 0.2, 0.3, 0.4],
        dirIds: ['d-vs-1'],
        topK: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      const hit = results.find((r) => r.chunkId === 'vs-1');
      expect(hit).toBeDefined();
      expect(hit!.document.file_id).toBe('f-vs-1');
    });

    it('deleteByFileId removes all chunks for that file', async () => {
      const docs = [
        makeDoc({ chunk_id: 'del-f-1', file_id: 'f-del', dir_id: 'd-del' }),
        makeDoc({ chunk_id: 'del-f-2', file_id: 'f-del', dir_id: 'd-del' }),
        makeDoc({ chunk_id: 'del-f-keep', file_id: 'f-keep', dir_id: 'd-del' }),
      ];
      await adapter.addDocuments(docs);
      await adapter.deleteByFileId('f-del');

      const results = await adapter.searchByVector({
        vector: [0.1, 0.2, 0.3, 0.4],
        dirIds: ['d-del'],
        topK: 10,
      });
      const ids = results.map((r) => r.chunkId);
      expect(ids).not.toContain('del-f-1');
      expect(ids).not.toContain('del-f-2');
      expect(ids).toContain('del-f-keep');
    });

    it('deleteByDirId removes all chunks for that dir', async () => {
      const docs = [
        makeDoc({ chunk_id: 'del-d-1', file_id: 'f-dd1', dir_id: 'd-to-delete' }),
        makeDoc({ chunk_id: 'del-d-2', file_id: 'f-dd2', dir_id: 'd-to-delete' }),
      ];
      await adapter.addDocuments(docs);
      await adapter.deleteByDirId('d-to-delete');

      const found = await adapter.getByChunkIds(['del-d-1', 'del-d-2']);
      expect(found).toHaveLength(0);
    });

    it('deleteByDirIds removes all chunks for those dirs', async () => {
      const docs = [
        makeDoc({ chunk_id: 'ddi-1', file_id: 'f-ddi1', dir_id: 'd-ddi-a' }),
        makeDoc({ chunk_id: 'ddi-2', file_id: 'f-ddi2', dir_id: 'd-ddi-b' }),
        makeDoc({ chunk_id: 'ddi-keep', file_id: 'f-ddi3', dir_id: 'd-ddi-c' }),
      ];
      await adapter.addDocuments(docs);
      await adapter.deleteByDirIds(['d-ddi-a', 'd-ddi-b']);

      const found = await adapter.getByChunkIds(['ddi-1', 'ddi-2', 'ddi-keep']);
      const ids = found.map((d) => d.chunk_id);
      expect(ids).not.toContain('ddi-1');
      expect(ids).not.toContain('ddi-2');
      expect(ids).toContain('ddi-keep');
    });

    it('getByChunkIds returns exact matches', async () => {
      const docs = [
        makeDoc({ chunk_id: 'get-1', file_id: 'f-get', dir_id: 'd-get' }),
        makeDoc({ chunk_id: 'get-2', file_id: 'f-get', dir_id: 'd-get' }),
      ];
      await adapter.addDocuments(docs);

      const found = await adapter.getByChunkIds(['get-1', 'get-2', 'nonexistent']);
      const ids = found.map((d) => d.chunk_id);
      expect(ids).toContain('get-1');
      expect(ids).toContain('get-2');
      expect(ids).not.toContain('nonexistent');
    });

    it('searchByVector with dirIds filters correctly', async () => {
      const docs = [
        makeDoc({ chunk_id: 'flt-1', file_id: 'f-flt1', dir_id: 'd-flt-a' }),
        makeDoc({ chunk_id: 'flt-2', file_id: 'f-flt2', dir_id: 'd-flt-b' }),
      ];
      await adapter.addDocuments(docs);

      const results = await adapter.searchByVector({
        vector: [0.1, 0.2, 0.3, 0.4],
        dirIds: ['d-flt-a'],
        topK: 10,
      });
      const ids = results.map((r) => r.chunkId);
      expect(ids).toContain('flt-1');
      expect(ids).not.toContain('flt-2');
    });

    it('searchByVector with empty dirIds returns results across all dirs', async () => {
      const docs = [
        makeDoc({ chunk_id: 'all-1', file_id: 'f-all1', dir_id: 'd-all-x' }),
        makeDoc({ chunk_id: 'all-2', file_id: 'f-all2', dir_id: 'd-all-y' }),
      ];
      await adapter.addDocuments(docs);

      const results = await adapter.searchByVector({
        vector: [0.1, 0.2, 0.3, 0.4],
        dirIds: [],
        topK: 100,
      });
      const ids = results.map((r) => r.chunkId);
      expect(ids).toContain('all-1');
      expect(ids).toContain('all-2');
    });
  });
}

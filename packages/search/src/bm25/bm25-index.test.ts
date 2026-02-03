import { describe, it, expect, beforeEach } from 'vitest';
import { BM25Index } from './bm25-index';
import type { BM25Document } from '@agent-fs/core';

describe('BM25Index', () => {
  let index: BM25Index;

  const createDoc = (id: string, content: string, dirId = 'dir1'): BM25Document => ({
    chunk_id: id,
    file_id: `file_${id}`,
    dir_id: dirId,
    file_path: `/path/to/${id}.md`,
    content,
    tokens: [],
    indexed_at: new Date().toISOString(),
    deleted_at: '',
  });

  beforeEach(() => {
    index = new BM25Index();
  });

  describe('addDocument', () => {
    it('should add a document', () => {
      const doc = createDoc('1', 'Python是一种编程语言');
      index.addDocument(doc);
      expect(index.size).toBe(1);
    });

    it('should replace existing document', () => {
      const doc1 = createDoc('1', 'first content');
      const doc2 = createDoc('1', 'second content');
      index.addDocument(doc1);
      index.addDocument(doc2);
      expect(index.size).toBe(1);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      index.addDocument(createDoc('1', 'Python是一种流行的编程语言'));
      index.addDocument(createDoc('2', 'JavaScript用于Web开发'));
      index.addDocument(createDoc('3', 'Python也可以用于Web开发'));
    });

    it('should find relevant documents', () => {
      const results = index.search('Python编程');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].document.content).toContain('Python');
    });

    it('should rank by relevance', () => {
      const results = index.search('Python');
      expect(results.length).toBe(2);
    });

    it('should respect topK', () => {
      const results = index.search('开发', { topK: 1 });
      expect(results.length).toBe(1);
    });

    it('should filter by dirId', () => {
      index.addDocument(createDoc('4', 'Python in another dir', 'dir2'));
      const results = index.search('Python', { dirId: 'dir1' });
      for (const r of results) {
        expect(r.document.dir_id).toBe('dir1');
      }
    });

    it('should filter by filePathPrefix', () => {
      const results = index.search('Python', { filePathPrefix: '/path/to/1' });
      expect(results.length).toBe(1);
    });

    it('should return empty for no match', () => {
      const results = index.search('完全不相关的内容xyz');
      expect(results.length).toBe(0);
    });
  });

  describe('delete', () => {
    it('should remove document', () => {
      const doc = createDoc('1', 'test content');
      index.addDocument(doc);
      expect(index.size).toBe(1);

      index.removeDocument('1');
      expect(index.size).toBe(0);
    });

    it('should soft delete document', () => {
      const doc = createDoc('1', 'test content');
      index.addDocument(doc);

      index.softDelete('1');
      expect(index.size).toBe(1);
      expect(index.activeSize).toBe(0);

      const results = index.search('test');
      expect(results.length).toBe(0);
    });

    it('should remove by dirId', () => {
      index.addDocument(createDoc('1', 'content1', 'dir1'));
      index.addDocument(createDoc('2', 'content2', 'dir1'));
      index.addDocument(createDoc('3', 'content3', 'dir2'));

      const count = index.removeByDirId('dir1');
      expect(count).toBe(2);
      expect(index.size).toBe(1);
    });
  });

  describe('serialization', () => {
    it('should serialize and deserialize', () => {
      index.addDocument(createDoc('1', 'Python编程'));
      index.addDocument(createDoc('2', 'JavaScript开发'));

      const json = index.toJSON();
      const restored = BM25Index.fromJSON(json);

      expect(restored.size).toBe(2);

      const results = restored.search('Python');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('compact', () => {
    it('should remove tombstones', () => {
      index.addDocument(createDoc('1', 'content1'));
      index.addDocument(createDoc('2', 'content2'));
      index.softDelete('1');

      expect(index.tombstoneRatio).toBeCloseTo(0.5);

      const removed = index.compact();
      expect(removed).toBe(1);
      expect(index.size).toBe(1);
      expect(index.tombstoneRatio).toBe(0);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BM25Index } from './bm25-index';
import { saveIndex, loadIndex, indexExists } from './persistence';
import type { BM25Document } from '@agent-fs/core';

describe('BM25 persistence', () => {
  const testDir = join(tmpdir(), 'bm25-test-' + Date.now());
  const indexPath = join(testDir, 'bm25', 'index.json');

  const createDoc = (id: string, content: string): BM25Document => ({
    chunk_id: id,
    file_id: `file_${id}`,
    dir_id: 'dir1',
    file_path: `/path/to/${id}.md`,
    content,
    tokens: [],
    indexed_at: new Date().toISOString(),
    deleted_at: '',
  });

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should save and load index', () => {
    const index = new BM25Index();
    index.addDocument(createDoc('1', 'Python编程语言'));
    index.addDocument(createDoc('2', 'JavaScript开发'));

    saveIndex(index, indexPath);
    expect(indexExists(indexPath)).toBe(true);

    const loaded = loadIndex(indexPath);
    expect(loaded.size).toBe(2);

    const results = loaded.search('Python');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should throw for missing file', () => {
    expect(() => loadIndex('/nonexistent/path.json')).toThrow('Index file not found');
  });

  it('should create directory if not exists', () => {
    const nestedPath = join(testDir, 'a', 'b', 'c', 'index.json');
    const index = new BM25Index();
    index.addDocument(createDoc('1', 'test'));

    saveIndex(index, nestedPath);
    expect(indexExists(nestedPath)).toBe(true);
  });
});

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import type { InvertedIndexAdapter, InvertedIndexEntry } from '../../types.js';

function makeEntries(count = 2): InvertedIndexEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    text: `hello world document chunk ${i}`,
    chunkId: `chunk-${i}`,
    locator: `L${i + 1}`,
  }));
}

export function describeInvertedIndexConformance(
  name: string,
  factory: () => Promise<InvertedIndexAdapter>,
  teardown: () => Promise<void>,
): void {
  describe(`InvertedIndexAdapter conformance: ${name}`, () => {
    let adapter: InvertedIndexAdapter;

    beforeAll(async () => {
      adapter = await factory();
      await adapter.init();
    });

    afterAll(async () => {
      await adapter.close();
      await teardown();
    });

    it('addFile + search returns matching results', async () => {
      await adapter.addFile('f-search', 'd-search', makeEntries(2));

      const results = await adapter.search({
        terms: ['hello'],
        dirIds: ['d-search'],
        topK: 10,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].chunkId).toBeDefined();
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('removeFile removes entries for that file', async () => {
      await adapter.addFile('f-remove', 'd-remove', makeEntries(2));
      await adapter.removeFile('f-remove');

      const results = await adapter.search({
        terms: ['hello'],
        dirIds: ['d-remove'],
        topK: 10,
      });
      expect(results).toHaveLength(0);
    });

    it('removeDirectory removes all entries for that dir', async () => {
      await adapter.addFile('f-rmd1', 'd-rmd', makeEntries(2));
      await adapter.addFile('f-rmd2', 'd-rmd', makeEntries(2));
      await adapter.removeDirectory('d-rmd');

      const results = await adapter.search({
        terms: ['hello'],
        dirIds: ['d-rmd'],
        topK: 10,
      });
      expect(results).toHaveLength(0);
    });

    it('removeDirectories removes entries for multiple dirs', async () => {
      await adapter.addFile('f-rdds1', 'd-rdds-a', makeEntries(1));
      await adapter.addFile('f-rdds2', 'd-rdds-b', makeEntries(1));
      await adapter.addFile('f-rdds3', 'd-rdds-c', [
        { text: 'unique term zxqwerty', chunkId: 'keep-chunk', locator: 'L1' },
      ]);
      await adapter.removeDirectories(['d-rdds-a', 'd-rdds-b']);

      const removed = await adapter.search({
        terms: ['hello'],
        dirIds: ['d-rdds-a', 'd-rdds-b'],
        topK: 10,
      });
      expect(removed).toHaveLength(0);

      const kept = await adapter.search({
        terms: ['zxqwerty'],
        dirIds: ['d-rdds-c'],
        topK: 10,
      });
      expect(kept.length).toBeGreaterThan(0);
    });

    it('search with dirIds filters correctly', async () => {
      await adapter.addFile('f-flt-a', 'd-flt-a', [
        { text: 'apple banana', chunkId: 'c-flt-a', locator: 'L1' },
      ]);
      await adapter.addFile('f-flt-b', 'd-flt-b', [
        { text: 'apple banana', chunkId: 'c-flt-b', locator: 'L1' },
      ]);

      const results = await adapter.search({
        terms: ['apple'],
        dirIds: ['d-flt-a'],
        topK: 10,
      });
      const ids = results.map((r) => r.chunkId);
      expect(ids).toContain('c-flt-a');
      expect(ids).not.toContain('c-flt-b');
    });
  });
}

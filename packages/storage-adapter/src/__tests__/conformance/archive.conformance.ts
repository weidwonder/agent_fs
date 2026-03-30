import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import type { DocumentArchiveAdapter } from '../../types.js';

export function describeArchiveConformance(
  name: string,
  factory: () => Promise<DocumentArchiveAdapter>,
  teardown: () => Promise<void>,
): void {
  describe(`DocumentArchiveAdapter conformance: ${name}`, () => {
    let adapter: DocumentArchiveAdapter;

    beforeAll(async () => {
      adapter = await factory();
    });

    afterAll(async () => {
      await teardown();
    });

    it('write + read returns correct content', async () => {
      await adapter.write('arc-1', {
        files: { 'content.txt': 'hello world' },
      });

      const text = await adapter.read('arc-1', 'content.txt');
      expect(text).toBe('hello world');
    });

    it('write + readBatch returns all requested files', async () => {
      await adapter.write('arc-batch', {
        files: {
          'a.txt': 'content-a',
          'b.txt': 'content-b',
          'c.txt': 'content-c',
        },
      });

      const batch = await adapter.readBatch('arc-batch', ['a.txt', 'b.txt', 'c.txt']);
      expect(batch['a.txt']).toBe('content-a');
      expect(batch['b.txt']).toBe('content-b');
      expect(batch['c.txt']).toBe('content-c');
    });

    it('exists returns true for existing archive', async () => {
      await adapter.write('arc-exists', { files: { 'f.txt': 'data' } });
      expect(await adapter.exists('arc-exists')).toBe(true);
    });

    it('exists returns false for missing archive', async () => {
      expect(await adapter.exists('arc-nonexistent-xyz')).toBe(false);
    });

    it('delete removes the archive', async () => {
      await adapter.write('arc-del', { files: { 'f.txt': 'data' } });
      await adapter.delete('arc-del');
      expect(await adapter.exists('arc-del')).toBe(false);
    });

    it('read after delete throws or returns empty', async () => {
      await adapter.write('arc-del2', { files: { 'f.txt': 'data' } });
      await adapter.delete('arc-del2');

      // Implementations may throw or return empty string; both are acceptable
      let result: string | undefined;
      try {
        result = await adapter.read('arc-del2', 'f.txt');
      } catch {
        result = undefined;
      }
      expect(result === undefined || result === '').toBe(true);
    });
  });
}

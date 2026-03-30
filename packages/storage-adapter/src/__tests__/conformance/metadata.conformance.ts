import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import type { IndexMetadata, MetadataAdapter } from '../../types.js';

function makeMetadata(dirId: string): IndexMetadata {
  return {
    version: '1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dirId,
    directoryPath: `/root/${dirId}`,
    directorySummary: 'test dir',
    projectId: 'proj-1',
    relativePath: '.',
    parentDirId: null,
    stats: { fileCount: 1, chunkCount: 5, totalTokens: 100 },
    files: [],
    subdirectories: [],
    unsupportedFiles: [],
  };
}

export function describeMetadataConformance(
  name: string,
  factory: () => Promise<MetadataAdapter>,
  teardown: () => Promise<void>,
): void {
  describe(`MetadataAdapter conformance: ${name}`, () => {
    let adapter: MetadataAdapter;

    beforeAll(async () => {
      adapter = await factory();
    });

    afterAll(async () => {
      await teardown();
    });

    it('writeIndexMetadata + readIndexMetadata roundtrip', async () => {
      const meta = makeMetadata('dir-rw');
      await adapter.writeIndexMetadata('dir-rw', meta);

      const read = await adapter.readIndexMetadata('dir-rw');
      expect(read).not.toBeNull();
      expect(read!.dirId).toBe('dir-rw');
      expect(read!.directorySummary).toBe('test dir');
      expect(read!.stats.chunkCount).toBe(5);
    });

    it('readIndexMetadata returns null for unknown dir', async () => {
      const result = await adapter.readIndexMetadata('dir-nonexistent-xyz');
      expect(result).toBeNull();
    });

    it('deleteIndexMetadata removes metadata', async () => {
      await adapter.writeIndexMetadata('dir-del', makeMetadata('dir-del'));
      await adapter.deleteIndexMetadata('dir-del');

      const result = await adapter.readIndexMetadata('dir-del');
      expect(result).toBeNull();
    });

    it('listSubdirectories returns expected structure', async () => {
      const parent = makeMetadata('dir-parent');
      await adapter.writeIndexMetadata('dir-parent', parent);

      const subs = await adapter.listSubdirectories('dir-parent');
      expect(Array.isArray(subs)).toBe(true);
      // Each entry must have dirId and relativePath
      for (const sub of subs) {
        expect(typeof sub.dirId).toBe('string');
        expect(typeof sub.relativePath).toBe('string');
      }
    });

    it('listProjects returns expected structure', async () => {
      const projects = await adapter.listProjects();
      expect(Array.isArray(projects)).toBe(true);
      for (const p of projects) {
        expect(typeof p.projectId).toBe('string');
        expect(typeof p.name).toBe('string');
        expect(typeof p.rootDirId).toBe('string');
      }
    });

    it('writeProjectMemoryFile + readProjectMemory roundtrip', async () => {
      await adapter.writeProjectMemoryFile('proj-mem', 'notes.md', '# Notes\nHello');

      const memory = await adapter.readProjectMemory('proj-mem');
      expect(memory).not.toBeNull();
      expect(memory!.files.some((f) => f.name === 'notes.md')).toBe(true);
    });

    it('readProjectMemory returns null for unknown project', async () => {
      const result = await adapter.readProjectMemory('proj-nonexistent-xyz');
      expect(result).toBeNull();
    });
  });
}

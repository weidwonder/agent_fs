import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IndexMetadata } from '@agent-fs/core';
import { dirTree } from './dir-tree';

function writeIndexMetadata(dirPath: string, metadata: IndexMetadata): void {
  const fsIndexPath = join(dirPath, '.fs_index');
  mkdirSync(fsIndexPath, { recursive: true });
  writeFileSync(join(fsIndexPath, 'index.json'), JSON.stringify(metadata, null, 2));
}

describe('dirTree', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'agent-fs-dir-tree-'));
    mkdirSync(join(rootDir, 'docs', 'nested'), { recursive: true });

    writeIndexMetadata(rootDir, {
      version: '2.0',
      createdAt: '2026-02-06T00:00:00.000Z',
      updatedAt: '2026-02-06T00:00:00.000Z',
      dirId: 'd-root',
      directoryPath: rootDir,
      directorySummary: 'root summary',
      projectId: 'd-root',
      relativePath: '.',
      parentDirId: null,
      stats: { fileCount: 3, chunkCount: 3, totalTokens: 30 },
      files: [
        {
          name: 'root.md',
          type: 'md',
          size: 10,
          hash: 'hash-root',
          fileId: 'f-root',
          indexedAt: '2026-02-06T00:00:00.000Z',
          chunkCount: 1,
          summary: 'root file',
        },
      ],
      subdirectories: [
        {
          name: 'docs',
          dirId: 'd-docs',
          hasIndex: true,
          summary: 'docs summary',
          fileCount: 2,
          lastUpdated: '2026-02-06T00:00:00.000Z',
          fileIds: ['f-docs', 'f-nested'],
        },
      ],
      unsupportedFiles: ['ignored.bin'],
    });

    writeIndexMetadata(join(rootDir, 'docs'), {
      version: '2.0',
      createdAt: '2026-02-06T00:00:00.000Z',
      updatedAt: '2026-02-06T00:00:00.000Z',
      dirId: 'd-docs',
      directoryPath: join(rootDir, 'docs'),
      directorySummary: 'docs summary',
      projectId: 'd-root',
      relativePath: 'docs',
      parentDirId: 'd-root',
      stats: { fileCount: 2, chunkCount: 2, totalTokens: 20 },
      files: [
        {
          name: 'a.md',
          type: 'md',
          size: 10,
          hash: 'hash-docs',
          fileId: 'f-docs',
          indexedAt: '2026-02-06T00:00:00.000Z',
          chunkCount: 1,
          summary: 'docs file',
        },
      ],
      subdirectories: [
        {
          name: 'nested',
          dirId: 'd-nested',
          hasIndex: true,
          summary: 'nested summary',
          fileCount: 1,
          lastUpdated: '2026-02-06T00:00:00.000Z',
          fileIds: ['f-nested'],
        },
      ],
      unsupportedFiles: [],
    });

    writeIndexMetadata(join(rootDir, 'docs', 'nested'), {
      version: '2.0',
      createdAt: '2026-02-06T00:00:00.000Z',
      updatedAt: '2026-02-06T00:00:00.000Z',
      dirId: 'd-nested',
      directoryPath: join(rootDir, 'docs', 'nested'),
      directorySummary: 'nested summary',
      projectId: 'd-root',
      relativePath: 'docs/nested',
      parentDirId: 'd-docs',
      stats: { fileCount: 1, chunkCount: 1, totalTokens: 10 },
      files: [
        {
          name: 'b.md',
          type: 'md',
          size: 10,
          hash: 'hash-nested',
          fileId: 'f-nested',
          indexedAt: '2026-02-06T00:00:00.000Z',
          chunkCount: 1,
          summary: 'nested file',
        },
      ],
      subdirectories: [],
      unsupportedFiles: [],
    });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('应返回递归层级目录树', async () => {
    const tree = await dirTree({ scope: rootDir, depth: 3 });

    expect(tree.path).toBe(rootDir);
    expect(tree.files).toHaveLength(1);
    expect(tree.subdirectories).toHaveLength(1);

    const docsNode = tree.subdirectories[0];
    expect(docsNode.path).toBe('docs');
    expect(docsNode.files).toHaveLength(1);
    expect(docsNode.subdirectories).toHaveLength(1);

    const nestedNode = docsNode.subdirectories[0];
    expect(nestedNode.path).toBe('nested');
    expect(nestedNode.files).toHaveLength(1);
  });

  it('应按 depth 限制递归层级', async () => {
    const tree = await dirTree({ scope: rootDir, depth: 1 });
    const docsNode = tree.subdirectories[0];

    expect(docsNode.subdirectories).toEqual([]);
  });

  it('scope 无索引时应抛错', async () => {
    await expect(dirTree({ scope: join(rootDir, 'missing') })).rejects.toThrow(
      'No index found at'
    );
  });
});

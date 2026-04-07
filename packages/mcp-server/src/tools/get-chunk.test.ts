import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = {
  homeDir: '',
  vectorDocs: new Map<
    string,
    {
      chunk_id: string;
      file_id: string;
      file_path: string;
      locator: string;
      chunk_line_start: number;
      chunk_line_end: number;
    }
  >(),
  afdFiles: new Map<string, { content: string }>(),
  projectArchiveReads: [] as string[],
  centralArchiveReads: [] as string[],
};

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => state.homeDir,
  };
});

vi.mock('./search.js', () => ({
  getStorageAdapter: () => ({
    vector: {
      getByChunkIds: async (chunkIds: string[]) =>
        chunkIds
          .map((chunkId) => state.vectorDocs.get(chunkId))
          .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    },
    archive: {
      read: async (fileId: string, fileName: string) => {
        state.centralArchiveReads.push(`${fileId}:${fileName}`);
        throw new Error(`missing AFD: ${fileId}/${fileName}`);
      },
    },
  }),
}));

vi.mock('@agent-fs/storage', () => ({
  createAFDStorage: ({ documentsDir }: { documentsDir: string }) => ({
    readText: async (fileId: string, fileName: string) => {
      state.projectArchiveReads.push(`${documentsDir}:${fileId}:${fileName}`);
      const item = state.afdFiles.get(`${documentsDir}:${fileId}`);
      if (!item || fileName !== 'content.md') {
        throw new Error(`missing AFD: ${documentsDir}/${fileId}/${fileName}`);
      }
      return item.content;
    },
  }),
}));

import { getChunk } from './get-chunk';

describe('getChunk', () => {
  let baseDir: string;
  let projectDir: string;

  beforeEach(() => {
    state.vectorDocs.clear();
    state.afdFiles.clear();
    state.projectArchiveReads = [];
    state.centralArchiveReads = [];

    baseDir = mkdtempSync(join(tmpdir(), 'agent-fs-mcp-get-chunk-'));
    state.homeDir = baseDir;
    projectDir = join(baseDir, 'project');

    mkdirSync(join(baseDir, '.agent_fs'), { recursive: true });
    mkdirSync(join(projectDir, '.fs_index'), { recursive: true });

    writeFileSync(
      join(baseDir, '.agent_fs', 'registry.json'),
      JSON.stringify(
        {
          version: '2.0',
          embeddingModel: 'mock',
          embeddingDimension: 3,
          projects: [
            {
              path: projectDir,
              alias: 'project',
              projectId: 'd1',
              summary: 'test',
              lastUpdated: '2026-02-06T00:00:00.000Z',
              totalFileCount: 1,
              totalChunkCount: 2,
              subdirectories: [],
              valid: true,
            },
          ],
        },
        null,
        2
      )
    );

    writeFileSync(
      join(projectDir, '.fs_index', 'index.json'),
      JSON.stringify(
        {
          version: '2.0',
          createdAt: '2026-02-06T00:00:00.000Z',
          updatedAt: '2026-02-06T00:00:00.000Z',
          dirId: 'd1',
          directoryPath: projectDir,
          directorySummary: 'test',
          projectId: 'd1',
          relativePath: '.',
          parentDirId: null,
          stats: { fileCount: 1, chunkCount: 2, totalTokens: 10 },
          files: [
            {
              name: 'a.md',
              type: 'md',
              size: 10,
              hash: 'sha256:xx',
              fileId: 'f1',
              indexedAt: '2026-02-06T00:00:00.000Z',
              chunkCount: 2,
              summary: 'doc summary',
            },
          ],
          subdirectories: [],
          unsupportedFiles: [],
        },
        null,
        2
      )
    );

    const documentsDir = join(projectDir, '.fs_index', 'documents');
    state.afdFiles.set(`${documentsDir}:a.md`, {
      content: '第一行\n第二行\n第三行',
    });

    state.vectorDocs.set('f1:0000', {
      chunk_id: 'f1:0000',
      file_id: 'f1',
      file_path: join(projectDir, 'a.md'),
      locator: 'line:1-1',
      chunk_line_start: 1,
      chunk_line_end: 1,
    });

    state.vectorDocs.set('f1:0001', {
      chunk_id: 'f1:0001',
      file_id: 'f1',
      file_path: join(projectDir, 'a.md'),
      locator: 'line:2-2',
      chunk_line_start: 2,
      chunk_line_end: 2,
    });
  });

  it('优先从 AFD 读取 chunk 内容，并支持邻居读取', async () => {
    const result = await getChunk({
      chunk_id: 'f1:0000',
      include_neighbors: true,
      neighbor_count: 1,
    });

    expect(result.chunk.content).toBe('第一行');
    expect(result.chunk.summary).toBe('');

    expect(result.neighbors?.after).toHaveLength(1);
    expect(result.neighbors?.after[0].id).toBe('f1:0001');
    expect(result.neighbors?.after[0].content).toBe('第二行');
    expect(result.neighbors?.after[0].summary).toBe('');
    expect(state.projectArchiveReads).toEqual([
      `${join(projectDir, '.fs_index', 'documents')}:a.md:content.md`,
    ]);
    expect(state.centralArchiveReads).toEqual([]);
  });

  it('chunk_id 非法时抛错', async () => {
    await expect(getChunk({ chunk_id: 'invalid' })).rejects.toThrow('Invalid chunk_id format');
  });

  it('应支持在子目录索引中定位 chunk', async () => {
    const subDir = join(projectDir, 'docs');
    mkdirSync(join(subDir, '.fs_index'), { recursive: true });

    writeFileSync(
      join(baseDir, '.agent_fs', 'registry.json'),
      JSON.stringify(
        {
          version: '2.0',
          embeddingModel: 'mock',
          embeddingDimension: 3,
          projects: [
            {
              path: projectDir,
              alias: 'project',
              projectId: 'd1',
              summary: 'test',
              lastUpdated: '2026-02-06T00:00:00.000Z',
              totalFileCount: 1,
              totalChunkCount: 1,
              subdirectories: [
                {
                  relativePath: 'docs',
                  dirId: 'd2',
                  fileCount: 1,
                  chunkCount: 1,
                  lastUpdated: '2026-02-06T00:00:00.000Z',
                },
              ],
              valid: true,
            },
          ],
        },
        null,
        2
      )
    );

    writeFileSync(
      join(projectDir, '.fs_index', 'index.json'),
      JSON.stringify(
        {
          version: '2.0',
          createdAt: '2026-02-06T00:00:00.000Z',
          updatedAt: '2026-02-06T00:00:00.000Z',
          dirId: 'd1',
          directoryPath: projectDir,
          directorySummary: 'test',
          projectId: 'd1',
          relativePath: '.',
          parentDirId: null,
          stats: { fileCount: 1, chunkCount: 1, totalTokens: 10 },
          files: [],
          subdirectories: [
            {
              name: 'docs',
              dirId: 'd2',
              hasIndex: true,
              summary: 'docs',
              fileCount: 1,
              lastUpdated: '2026-02-06T00:00:00.000Z',
              fileIds: ['f-sub'],
            },
          ],
          unsupportedFiles: [],
        },
        null,
        2
      )
    );

    writeFileSync(
      join(subDir, '.fs_index', 'index.json'),
      JSON.stringify(
        {
          version: '2.0',
          createdAt: '2026-02-06T00:00:00.000Z',
          updatedAt: '2026-02-06T00:00:00.000Z',
          dirId: 'd2',
          directoryPath: subDir,
          directorySummary: 'docs',
          projectId: 'd1',
          relativePath: 'docs',
          parentDirId: 'd1',
          stats: { fileCount: 1, chunkCount: 1, totalTokens: 10 },
          files: [
            {
              name: 'b.md',
              type: 'md',
              size: 10,
              hash: 'hash-sub',
              fileId: 'f-sub',
              indexedAt: '2026-02-06T00:00:00.000Z',
              chunkCount: 1,
              summary: 'sub summary',
            },
          ],
          subdirectories: [],
          unsupportedFiles: [],
        },
        null,
        2
      )
    );

    const subDirDocumentsDir = join(subDir, '.fs_index', 'documents');
    state.afdFiles.set(`${subDirDocumentsDir}:b.md`, {
      content: '子目录第一行\n子目录第二行',
    });

    state.vectorDocs.set('f-sub:0000', {
      chunk_id: 'f-sub:0000',
      file_id: 'f-sub',
      file_path: join(subDir, 'b.md'),
      locator: 'line:1-1',
      chunk_line_start: 1,
      chunk_line_end: 1,
    });

    const result = await getChunk({ chunk_id: 'f-sub:0000' });
    expect(result.chunk.content).toBe('子目录第一行');
    expect(result.chunk.summary).toBe('');
  });

  it('fileId 在当前 index 中失联时，应回退使用向量文档 file_path 定位归档', async () => {
    const orphanDir = join(projectDir, 'legacy');
    mkdirSync(join(orphanDir, '.fs_index'), { recursive: true });
    const orphanDocumentsDir = join(orphanDir, '.fs_index', 'documents');

    state.afdFiles.set(`${orphanDocumentsDir}:legacy.md`, {
      content: '历史第一行\n历史第二行',
    });

    state.vectorDocs.set('legacy-file:0000', {
      chunk_id: 'legacy-file:0000',
      file_id: 'legacy-file',
      file_path: join(orphanDir, 'legacy.md'),
      locator: 'line:1-1',
      chunk_line_start: 1,
      chunk_line_end: 1,
    });

    const result = await getChunk({ chunk_id: 'legacy-file:0000' });

    expect(result.chunk.content).toBe('历史第一行');
    expect(result.chunk.source.file_path).toBe(join(orphanDir, 'legacy.md'));
    expect(state.projectArchiveReads).toContain(
      `${orphanDocumentsDir}:legacy.md:content.md`,
    );
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });
});

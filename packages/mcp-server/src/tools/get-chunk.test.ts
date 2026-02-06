import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = {
  homeDir: '',
  vectorDocs: new Map<string, { chunk_id: string; file_id: string; file_path: string; locator: string; content: string; summary: string }>(),
  afdFiles: new Map<string, { content: string; summaries: Record<string, string> }>(),
};

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => state.homeDir,
  };
});

vi.mock('./search.js', () => ({
  getVectorStore: () => ({
    getByChunkIds: async (chunkIds: string[]) =>
      chunkIds
        .map((chunkId) => state.vectorDocs.get(chunkId))
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
  }),
}));

vi.mock('@agent-fs/storage', () => ({
  createAFDStorage: ({ documentsDir }: { documentsDir: string }) => ({
    readText: async (fileId: string, filePath: string) => {
      const data = state.afdFiles.get(`${documentsDir}:${fileId}`);
      if (!data || filePath !== 'content.md') {
        throw new Error(`missing AFD text: ${fileId}/${filePath}`);
      }
      return data.content;
    },
    read: async (fileId: string, filePath: string) => {
      const data = state.afdFiles.get(`${documentsDir}:${fileId}`);
      if (!data || filePath !== 'summaries.json') {
        throw new Error(`missing AFD buffer: ${fileId}/${filePath}`);
      }
      return Buffer.from(JSON.stringify(data.summaries), 'utf-8');
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

    baseDir = mkdtempSync(join(tmpdir(), 'agent-fs-mcp-get-chunk-'));
    state.homeDir = baseDir;
    projectDir = join(baseDir, 'project');

    mkdirSync(join(baseDir, '.agent_fs'), { recursive: true });
    mkdirSync(join(projectDir, '.fs_index'), { recursive: true });

    writeFileSync(
      join(baseDir, '.agent_fs', 'registry.json'),
      JSON.stringify(
        {
          version: '1.0',
          embeddingModel: 'mock',
          embeddingDimension: 3,
          indexedDirectories: [
            {
              path: projectDir,
              alias: 'project',
              dirId: 'd1',
              summary: 'test',
              lastUpdated: '2026-02-06T00:00:00.000Z',
              fileCount: 1,
              chunkCount: 2,
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
          version: '1.0',
          createdAt: '2026-02-06T00:00:00.000Z',
          updatedAt: '2026-02-06T00:00:00.000Z',
          dirId: 'd1',
          directoryPath: projectDir,
          directorySummary: 'test',
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
              chunkIds: ['f1:0000', 'f1:0001'],
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
    state.afdFiles.set(`${documentsDir}:f1`, {
      content: '第一行\n第二行\n第三行',
      summaries: {
        'f1:0000': '摘要一',
        'f1:0001': '摘要二',
      },
    });

    state.vectorDocs.set('f1:0000', {
      chunk_id: 'f1:0000',
      file_id: 'f1',
      file_path: join(projectDir, 'a.md'),
      locator: 'line:1-1',
      content: '旧内容一',
      summary: '旧摘要一',
    });

    state.vectorDocs.set('f1:0001', {
      chunk_id: 'f1:0001',
      file_id: 'f1',
      file_path: join(projectDir, 'a.md'),
      locator: 'line:2-2',
      content: '旧内容二',
      summary: '旧摘要二',
    });
  });

  it('优先从 AFD 读取 chunk 内容和 summary，并支持邻居读取', async () => {
    const result = await getChunk({
      chunk_id: 'f1:0000',
      include_neighbors: true,
      neighbor_count: 1,
    });

    expect(result.chunk.content).toBe('第一行');
    expect(result.chunk.summary).toBe('摘要一');

    expect(result.neighbors?.after).toHaveLength(1);
    expect(result.neighbors?.after[0].id).toBe('f1:0001');
    expect(result.neighbors?.after[0].content).toBe('第二行');
    expect(result.neighbors?.after[0].summary).toBe('摘要二');
  });

  it('chunk_id 非法时抛错', async () => {
    await expect(getChunk({ chunk_id: 'invalid' })).rejects.toThrow('Invalid chunk_id format');
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });
});

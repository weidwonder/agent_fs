import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = {
  homeDir: '',
  afdFiles: new Map<string, { content: string; summaries: Record<string, string> }>(),
};

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => state.homeDir,
  };
});

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

vi.mock('@agent-fs/search', () => ({
  createVectorStore: vi.fn(),
  InvertedIndex: class {},
  DirectoryResolver: class {
    expandDirIds(dirIds: string[]) {
      return dirIds;
    }
  },
  fusionRRF: <T>(
    lists: Array<{ name: string; items: T[] }>,
    getId: (item: T) => string,
    merge?: (existing: T, next: T, source: string) => T
  ) => {
    const merged = new Map<string, { item: T; score: number; sources: string[] }>();
    for (const list of lists) {
      list.items.forEach((item, index) => {
        const id = getId(item);
        const score = 1 / (60 + index + 1);
        const existed = merged.get(id);
        if (existed) {
          existed.score += score;
          existed.sources.push(list.name);
          existed.item = merge ? merge(existed.item, item, list.name) : existed.item;
        } else {
          merged.set(id, { item, score, sources: [list.name] });
        }
      });
    }

    return [...merged.values()].sort((a, b) => b.score - a.score);
  },
}));

import {
  search,
  __resetSearchServicesForTest,
  __setSearchServicesForTest,
} from './search';

describe('search', () => {
  let baseDir: string;
  let projectDir: string;

  beforeEach(() => {
    state.afdFiles.clear();

    baseDir = mkdtempSync(join(tmpdir(), 'agent-fs-mcp-search-'));
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
      summaries: {
        'f1:0000': '摘要一',
        'f1:0001': '摘要二',
      },
    });
  });

  afterEach(() => {
    __resetSearchServicesForTest();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('融合结果会从 AFD 补全文本和摘要', async () => {
    const invertedCalls: Array<{ query: string; options: { dirIds?: string[]; topK?: number } }> = [];
    const searchByHybrid = vi.fn().mockResolvedValue([
      {
        chunk_id: 'f1:0000',
        score: 0.9,
        document: {
          chunk_id: 'f1:0000',
          file_id: 'f1',
          dir_id: 'd1',
          rel_path: 'a.md',
          file_path: join(projectDir, 'a.md'),
          chunk_line_start: 1,
          chunk_line_end: 1,
          content_vector: [],
          summary_vector: [],
          locator: 'line:1-1',
          indexed_at: '',
          deleted_at: '',
        },
      },
    ]);

    __setSearchServicesForTest({
      embeddingService: {
        embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      } as any,
      vectorStore: {
        searchByHybrid,
        getByChunkIds: vi.fn().mockResolvedValue([]),
      } as any,
      invertedIndex: {
        search: vi.fn().mockImplementation(async (query: string, options: { dirIds?: string[]; topK?: number }) => {
          invertedCalls.push({ query, options });
          return [
            {
              chunkId: 'f1:0001',
              fileId: 'f1',
              dirId: 'd1',
              locator: 'line:2-2',
              score: 1.1,
            },
          ];
        }),
      } as any,
    });

    const result = await search({
      query: '第一行',
      keyword: '第二行',
      scope: projectDir,
      top_k: 5,
    });

    expect(result.results.length).toBeGreaterThanOrEqual(2);
    expect(result.results.some((item) => item.content === '第一行' && item.summary === '摘要一')).toBe(true);
    expect(result.results.some((item) => item.content === '第二行' && item.summary === '摘要二')).toBe(true);

    expect(invertedCalls).toHaveLength(1);
    expect(invertedCalls[0].options.dirIds).toEqual(['d1']);
    expect(searchByHybrid).toHaveBeenCalledTimes(1);
  });

  it('非 line 定位符应回退使用 chunk 行范围提取正文（向量结果）', async () => {
    __setSearchServicesForTest({
      embeddingService: {
        embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      } as any,
      vectorStore: {
        searchByHybrid: vi.fn().mockResolvedValue([
          {
            chunk_id: 'f1:0001',
            score: 0.9,
            document: {
              chunk_id: 'f1:0001',
              file_id: 'f1',
              dir_id: 'd1',
              rel_path: 'a.md',
              file_path: join(projectDir, 'a.md'),
              chunk_line_start: 2,
              chunk_line_end: 2,
              content_vector: [],
              summary_vector: [],
              locator: 'sheet:销售数据/range:A1:B10',
              indexed_at: '',
              deleted_at: '',
            },
          },
        ]),
        getByChunkIds: vi.fn().mockResolvedValue([]),
      } as any,
      invertedIndex: {
        search: vi.fn().mockResolvedValue([]),
      } as any,
    });

    const result = await search({
      query: '销售数据',
      scope: projectDir,
      top_k: 5,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].chunk_id).toBe('f1:0001');
    expect(result.results[0].content).toBe('第二行');
  });

  it('keyword-only 且非 line 定位符时应通过向量元数据回填正文', async () => {
    const getByChunkIds = vi.fn().mockResolvedValue([
      {
        chunk_id: 'f1:0001',
        file_id: 'f1',
        dir_id: 'd1',
        rel_path: 'a.md',
        file_path: join(projectDir, 'a.md'),
        chunk_line_start: 2,
        chunk_line_end: 2,
        locator: 'line:2-2',
      },
    ]);

    __setSearchServicesForTest({
      embeddingService: {
        embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      } as any,
      vectorStore: {
        searchByHybrid: vi.fn().mockResolvedValue([]),
        getByChunkIds,
      } as any,
      invertedIndex: {
        search: vi.fn().mockResolvedValue([
          {
            chunkId: 'f1:0001',
            fileId: 'f1',
            dirId: 'd1',
            locator: 'sheet:销售数据/range:A1:B10',
            score: 1.1,
          },
        ]),
      } as any,
    });

    const result = await search({
      query: '销售数据',
      keyword: '销售额',
      scope: projectDir,
      top_k: 5,
    });

    expect(getByChunkIds).toHaveBeenCalledWith(['f1:0001']);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].content).toBe('第二行');
  });
});

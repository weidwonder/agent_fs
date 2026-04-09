import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const moduleMocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({
    embedding: {
      provider: 'mock',
      model: 'mock-embedding',
    },
  })),
  createEmbeddingService: vi.fn(),
  createLocalAdapter: vi.fn(),
}));

const state = {
  homeDir: '',
  afdFiles: new Map<string, {
    content: string;
    summaries: { documentSummary: string };
    mapping?: Array<{ markdownRange: { startLine: number; endLine: number }; originalLocator: string }>;
  }>(),
};

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => state.homeDir,
  };
});

vi.mock('@agent-fs/core', () => ({
  loadConfig: moduleMocks.loadConfig,
}));

vi.mock('@agent-fs/llm', () => ({
  createEmbeddingService: moduleMocks.createEmbeddingService,
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
  aggregateTopByFile: <T>(
    fused: Array<{ item: T; score: number; sources: string[] }>,
    topK: number,
    getFileKey: (item: T) => string | null | undefined,
    getChunkId: (item: T) => string
  ) => {
    const groups = new Map<string, {
      representative: { item: T; score: number; sources: string[] };
      scoreSum: number;
      chunkIds: string[];
      chunkIdSet: Set<string>;
      sources: Set<string>;
    }>();

    for (const row of fused) {
      const key = ((getFileKey(row.item) || '').trim()) || `__chunk__:${getChunkId(row.item)}`;
      const chunkId = getChunkId(row.item);
      const group = groups.get(key);
      if (!group) {
        groups.set(key, {
          representative: row,
          scoreSum: row.score,
          chunkIds: chunkId ? [chunkId] : [],
          chunkIdSet: new Set(chunkId ? [chunkId] : []),
          sources: new Set(row.sources),
        });
        continue;
      }

      group.scoreSum += row.score;
      if (chunkId && !group.chunkIdSet.has(chunkId)) {
        group.chunkIdSet.add(chunkId);
        group.chunkIds.push(chunkId);
      }
      for (const source of row.sources) {
        group.sources.add(source);
      }
      if (row.score > group.representative.score) {
        group.representative = row;
      }
    }

    return [...groups.values()]
      .map((group) => ({
        item: group.representative.item,
        score: group.representative.score + (group.scoreSum - group.representative.score) * 0.35,
        sources: [...group.sources],
        chunkHits: group.chunkIds.length,
        chunkIds: [...group.chunkIds],
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  },
}));

vi.mock('@agent-fs/storage-adapter', () => ({
  createLocalAdapter: moduleMocks.createLocalAdapter,
}));

import {
  initSearchService,
  search,
  stripPageMarkers,
  __resetSearchServicesForTest,
  __setSearchServicesForTest,
} from './search';

// Helper to build a storageAdapter mock from old-style vectorStore+invertedIndex mocks
function makeAdapterMock(opts: {
  vectorResults?: Array<{ chunk_id: string; score: number; document: Record<string, unknown> }>;
  invertedResults?: Array<{ chunkId: string; fileId: string; dirId?: string; locator: string; score: number }>;
  getByChunkIdsResult?: Array<Record<string, unknown>>;
  searchByVector?: ReturnType<typeof vi.fn>;
  getByChunkIds?: ReturnType<typeof vi.fn>;
  invertedSearch?: ReturnType<typeof vi.fn>;
}) {
  const vectorResults = opts.vectorResults ?? [];
  const invertedResults = opts.invertedResults ?? [];

  return {
    vector: {
      searchByVector: opts.searchByVector ?? vi.fn().mockResolvedValue(
        vectorResults.map((r) => ({
          chunkId: r.chunk_id,
          score: r.score,
          document: r.document,
        }))
      ),
      getByChunkIds: opts.getByChunkIds ?? vi.fn().mockResolvedValue(opts.getByChunkIdsResult ?? []),
    },
    invertedIndex: {
      search: opts.invertedSearch ?? vi.fn().mockResolvedValue(invertedResults),
    },
    archive: {
      read: vi.fn().mockImplementation(async (fileId: string, filePath: string) => {
        // Look up from state using any documentsDir key that matches this fileId
        for (const [key, data] of state.afdFiles) {
          const keyFileId = key.split(':').pop();
          if (keyFileId === fileId) {
            if (filePath === 'content.md') return data.content;
            if (filePath === 'summaries.json') return JSON.stringify(data.summaries);
            if (filePath === 'metadata.json') return JSON.stringify({ mapping: data.mapping ?? [] });
          }
        }
        throw new Error(`missing AFD: ${fileId}/${filePath}`);
      }),
    },
    init: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    metadata: {} as any,
  };
}

describe('initSearchService', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'agent-fs-mcp-search-init-'));
    state.homeDir = baseDir;
    mkdirSync(join(baseDir, '.agent_fs', 'storage', 'vectors'), { recursive: true });

    moduleMocks.loadConfig.mockClear();
    moduleMocks.createEmbeddingService.mockReset();
    moduleMocks.createLocalAdapter.mockReset();
  });

  afterEach(() => {
    __resetSearchServicesForTest();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('并发初始化时只创建一组搜索服务实例', async () => {
    const embeddingService = {
      init: vi.fn().mockImplementation(async () => {
        await Promise.resolve();
      }),
      getDimension: vi.fn().mockReturnValue(1024),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const storageAdapter = {
      init: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    moduleMocks.createEmbeddingService.mockReturnValue(embeddingService);
    moduleMocks.createLocalAdapter.mockReturnValue(storageAdapter);

    await Promise.all([initSearchService(), initSearchService(), initSearchService()]);

    expect(moduleMocks.createEmbeddingService).toHaveBeenCalledTimes(1);
    expect(moduleMocks.createLocalAdapter).toHaveBeenCalledTimes(1);
    expect(embeddingService.init).toHaveBeenCalledTimes(1);
    expect(storageAdapter.init).toHaveBeenCalledTimes(1);
  });

  it('初始化失败时会清理资源并允许后续重试', async () => {
    const failedEmbeddingService = {
      init: vi.fn().mockResolvedValue(undefined),
      getDimension: vi.fn().mockReturnValue(1024),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const failedStorageAdapter = {
      init: vi.fn().mockRejectedValue(new Error('adapter init failed')),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const nextEmbeddingService = {
      init: vi.fn().mockResolvedValue(undefined),
      getDimension: vi.fn().mockReturnValue(1024),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const nextStorageAdapter = {
      init: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    moduleMocks.createEmbeddingService
      .mockReturnValueOnce(failedEmbeddingService)
      .mockReturnValueOnce(nextEmbeddingService);
    moduleMocks.createLocalAdapter
      .mockReturnValueOnce(failedStorageAdapter)
      .mockReturnValueOnce(nextStorageAdapter);

    await expect(initSearchService()).rejects.toThrow('adapter init failed');
    expect(failedEmbeddingService.dispose).toHaveBeenCalledTimes(1);
    expect(failedStorageAdapter.close).toHaveBeenCalledTimes(1);

    await expect(initSearchService()).resolves.toBeUndefined();
    expect(moduleMocks.createEmbeddingService).toHaveBeenCalledTimes(2);
    expect(moduleMocks.createLocalAdapter).toHaveBeenCalledTimes(2);
  });
});

describe('stripPageMarkers', () => {
  it('空输入应返回空字符串', () => {
    expect(stripPageMarkers('')).toBe('');
  });

  it('重复调用应保持幂等', () => {
    const content = '<!-- page: 1 -->\n\n第一行\n<!-- page: 2 -->\n\n第二行';
    const once = stripPageMarkers(content);
    const twice = stripPageMarkers(once);

    expect(once).toBe('第一行\n第二行');
    expect(twice).toBe(once);
  });
});

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

    state.afdFiles.set(`${join(projectDir, '.fs_index', 'documents')}:a.md`, {
      content: '第一行\n第二行\n第三行',
      summaries: { documentSummary: 'doc summary' },
    });
  });

  afterEach(() => {
    __resetSearchServicesForTest();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('融合结果会从 AFD 补全文本和摘要', async () => {
    const invertedCalls: Array<{ terms: string[]; dirIds: string[]; topK: number }> = [];
    const searchByVector = vi.fn().mockResolvedValue([
      {
        chunkId: 'f1:0000',
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
      storageAdapter: {
        ...makeAdapterMock({
          searchByVector,
          invertedSearch: vi.fn().mockImplementation(async (params: { terms: string[]; dirIds: string[]; topK: number }) => {
            invertedCalls.push(params);
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
        }),
      } as any,
    });

    const result = await search({
      query: '第一行',
      keyword: '第二行',
      scope: projectDir,
      top_k: 5,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].content).toBe('第二行');
    expect(result.results[0].summary).toBe('doc summary');
    expect(result.results[0].chunk_hits).toBe(2);
    expect(result.results[0].aggregated_chunk_ids).toEqual(['f1:0000', 'f1:0001']);

    expect(invertedCalls).toHaveLength(1);
    expect(invertedCalls[0].dirIds).toEqual(['d1']);
    expect(searchByVector).toHaveBeenCalledTimes(1);
  });

  it('应从返回内容中剥离页码注释', async () => {
    const documentsDir = join(projectDir, '.fs_index', 'documents');
    state.afdFiles.set(`${documentsDir}:a.md`, {
      content: '<!-- page: 1 -->\n\n第一行\n<!-- page: 2 -->\n\n第二行',
      summaries: { documentSummary: 'doc summary' },
    });

    __setSearchServicesForTest({
      embeddingService: {
        embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      } as any,
      storageAdapter: makeAdapterMock({
        vectorResults: [
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
              chunk_line_end: 6,
              content_vector: [],
              locator: 'line:1-6',
              indexed_at: '',
              deleted_at: '',
            },
          },
        ],
      }) as any,
    });

    const result = await search({
      query: '第一行',
      scope: projectDir,
      top_k: 5,
    });

    expect(result.results[0].content).toBe('第一行\n第二行');
  });

  it('同文件关键词命中被聚合后，应优先选中关键词快照对应的 chunk 作为代表结果', async () => {
    const documentsDir = join(projectDir, '.fs_index', 'documents');
    state.afdFiles.set(`${documentsDir}:a.md`, {
      content: '向量命中的代表段落\n这是被聚合的关键词命中片段，前文后文都在这里\n结尾行',
      summaries: { documentSummary: 'doc summary' },
    });

    __setSearchServicesForTest({
      embeddingService: {
        embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      } as any,
      storageAdapter: makeAdapterMock({
        vectorResults: [
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
              locator: 'line:1-1',
              indexed_at: '',
              deleted_at: '',
            },
          },
        ],
        invertedResults: [
          {
            chunkId: 'f1:0001',
            fileId: 'f1',
            dirId: 'd1',
            locator: 'line:2-2',
            score: 1.1,
          },
        ],
      }) as any,
    });

    const result = await search({
      query: '代表段落',
      keyword: '关键词命中',
      scope: projectDir,
      top_k: 5,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].chunk_id).toBe('f1:0001');
    expect(result.results[0].content).toContain('关键词命中片段');
    expect(result.results[0].aggregated_chunk_ids).toEqual(['f1:0000', 'f1:0001']);
    expect(result.results[0].keyword_snippets).toEqual([
      {
        chunk_id: 'f1:0001',
        locator: 'line:2-2',
        text: expect.stringContaining('关键词命中'),
      },
    ]);
  });

  it('标题或条款锚点更强的文件，应在结果中优先展示', async () => {
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
              totalFileCount: 2,
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
          stats: { fileCount: 2, chunkCount: 2, totalTokens: 20 },
          files: [
            {
              name: 'guide.md',
              afdName: 'guide.md',
              type: 'md',
              size: 10,
              hash: 'sha256:guide',
              fileId: 'f1',
              indexedAt: '2026-02-06T00:00:00.000Z',
              chunkCount: 1,
              summary: 'guide',
            },
            {
              name: 'standard.md',
              afdName: 'standard.md',
              type: 'md',
              size: 10,
              hash: 'sha256:std',
              fileId: 'f2',
              indexedAt: '2026-02-06T00:00:00.000Z',
              chunkCount: 1,
              summary: 'standard',
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
    state.afdFiles.set(`${documentsDir}:guide.md`, {
      content: '# 应用指南\n借款费用资本化的说明性内容，主要讨论计算口径。',
      summaries: { documentSummary: 'guide' },
    });
    state.afdFiles.set(`${documentsDir}:standard.md`, {
      content:
        '# 第二章 确认和计量\n第五条 借款费用同时满足下列条件的，才能开始资本化：\n（一）资产支出已经发生；',
      summaries: { documentSummary: 'standard' },
    });

    __setSearchServicesForTest({
      embeddingService: {
        embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      } as any,
      storageAdapter: makeAdapterMock({
        vectorResults: [
          {
            chunk_id: 'f1:0000',
            score: 0.91,
            document: {
              chunk_id: 'f1:0000',
              file_id: 'f1',
              dir_id: 'd1',
              rel_path: 'guide.md',
              file_path: join(projectDir, 'guide.md'),
              chunk_line_start: 1,
              chunk_line_end: 2,
              locator: 'line:1-2',
            },
          },
          {
            chunk_id: 'f2:0000',
            score: 0.88,
            document: {
              chunk_id: 'f2:0000',
              file_id: 'f2',
              dir_id: 'd1',
              rel_path: 'standard.md',
              file_path: join(projectDir, 'standard.md'),
              chunk_line_start: 1,
              chunk_line_end: 3,
              locator: 'line:1-3',
            },
          },
        ],
        invertedResults: [
          {
            chunkId: 'f1:0000',
            fileId: 'f1',
            dirId: 'd1',
            locator: 'line:1-2',
            score: 1.2,
          },
          {
            chunkId: 'f2:0000',
            fileId: 'f2',
            dirId: 'd1',
            locator: 'line:1-3',
            score: 1.0,
          },
        ],
      }) as any,
    });

    const result = await search({
      query: '借款费用开始资本化需满足哪些条件',
      keyword: '开始资本化',
      scope: projectDir,
      top_k: 2,
    });

    expect(result.results).toHaveLength(2);
    expect(result.results[0].chunk_id).toBe('f2:0000');
    expect(result.results[0].source.file_path).toBe(join(projectDir, 'standard.md'));
    expect(result.results[0].content).toContain('才能开始资本化');
  });

  it('多目录 scope 应只触发一次向量检索并使用 dirIds 过滤', async () => {
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
              subdirectories: [
                {
                  relativePath: 'sub-a',
                  dirId: 'd1-sub-a',
                  fileCount: 0,
                  chunkCount: 0,
                  lastUpdated: '2026-02-06T00:00:00.000Z',
                },
                {
                  relativePath: 'sub-b',
                  dirId: 'd1-sub-b',
                  fileCount: 0,
                  chunkCount: 0,
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

    const searchByVector = vi.fn().mockResolvedValue([
      {
        chunkId: 'f1:0000',
        score: 0.8,
        document: {
          chunk_id: 'f1:0000',
          file_id: 'f1',
          dir_id: 'd1',
          rel_path: 'a.md',
          file_path: join(projectDir, 'a.md'),
          chunk_line_start: 1,
          chunk_line_end: 1,
          content_vector: [],
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
      storageAdapter: makeAdapterMock({
        searchByVector,
        invertedResults: [],
      }) as any,
    });

    await search({
      query: '第一行',
      scope: [join(projectDir, 'sub-a'), join(projectDir, 'sub-b')],
      top_k: 5,
    });

    expect(searchByVector).toHaveBeenCalledTimes(1);
    expect(searchByVector).toHaveBeenCalledWith({
      vector: [0.1, 0.2, 0.3],
      dirIds: ['d1-sub-a', 'd1-sub-b'],
      topK: 15,
      mode: 'postfilter',
      minResultsBeforeFallback: 5,
    });
  });

  it('非 line 定位符应回退使用 chunk 行范围提取正文（向量结果）', async () => {
    __setSearchServicesForTest({
      embeddingService: {
        embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      } as any,
      storageAdapter: makeAdapterMock({
        vectorResults: [
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
              locator: 'sheet:销售数据/range:A1:B10',
              indexed_at: '',
              deleted_at: '',
            },
          },
        ],
        invertedResults: [],
      }) as any,
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
      storageAdapter: makeAdapterMock({
        vectorResults: [],
        getByChunkIds,
        invertedResults: [
          {
            chunkId: 'f1:0001',
            fileId: 'f1',
            dirId: 'd1',
            locator: 'sheet:销售数据/range:A1:B10',
            score: 1.1,
          },
        ],
      }) as any,
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

  it('Excel 结果应优先展示 sheet/range 定位符（MCP）', async () => {
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
          files: [
            {
              name: 'report.xlsx',
              type: 'xlsx',
              size: 10,
              hash: 'sha256:yy',
              fileId: 'f1',
              afdName: 'report.xlsx',
              indexedAt: '2026-02-06T00:00:00.000Z',
              chunkCount: 1,
              summary: 'excel summary',
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
    state.afdFiles.set(`${documentsDir}:report.xlsx`, {
      content: '标题\n第一行\n第二行',
      summaries: { documentSummary: 'excel summary' },
      mapping: [
        {
          markdownRange: { startLine: 2, endLine: 3 },
          originalLocator: 'sheet:销售数据/range:A1:B2',
        },
      ],
    });

    __setSearchServicesForTest({
      embeddingService: {
        embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      } as any,
      storageAdapter: makeAdapterMock({
        vectorResults: [
          {
            chunk_id: 'f1:0000',
            score: 0.9,
            document: {
              chunk_id: 'f1:0000',
              file_id: 'f1',
              dir_id: 'd1',
              rel_path: 'report.xlsx',
              file_path: join(projectDir, 'report.xlsx'),
              chunk_line_start: 2,
              chunk_line_end: 3,
              content_vector: [],
              locator: 'line:2-3',
              indexed_at: '',
              deleted_at: '',
            },
          },
        ],
        invertedResults: [],
      }) as any,
    });

    const result = await search({
      query: '销售数据',
      scope: projectDir,
      top_k: 5,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].source.locator).toBe('sheet:销售数据/range:A1:B2');
  });

  it('同一文件多个 chunk 命中时应只占用一个 Top 位', async () => {
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
          stats: { fileCount: 2, chunkCount: 3, totalTokens: 20 },
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
            {
              name: 'b.md',
              type: 'md',
              size: 10,
              hash: 'sha256:xy',
              fileId: 'f2',
              indexedAt: '2026-02-06T00:00:00.000Z',
              chunkCount: 1,
              summary: 'doc summary b',
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
      summaries: { documentSummary: 'doc summary' },
    });
    state.afdFiles.set(`${documentsDir}:b.md`, {
      content: '甲行\n乙行',
      summaries: { documentSummary: 'doc summary b' },
    });

    __setSearchServicesForTest({
      embeddingService: {
        embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      } as any,
      storageAdapter: makeAdapterMock({
        vectorResults: [
          {
            chunk_id: 'f1:0000',
            score: 0.95,
            document: {
              chunk_id: 'f1:0000',
              file_id: 'f1',
              dir_id: 'd1',
              rel_path: 'a.md',
              file_path: join(projectDir, 'a.md'),
              chunk_line_start: 1,
              chunk_line_end: 1,
              locator: 'line:1-1',
            },
          },
          {
            chunk_id: 'f1:0001',
            score: 0.92,
            document: {
              chunk_id: 'f1:0001',
              file_id: 'f1',
              dir_id: 'd1',
              rel_path: 'a.md',
              file_path: join(projectDir, 'a.md'),
              chunk_line_start: 2,
              chunk_line_end: 2,
              locator: 'line:2-2',
            },
          },
          {
            chunk_id: 'f2:0000',
            score: 0.88,
            document: {
              chunk_id: 'f2:0000',
              file_id: 'f2',
              dir_id: 'd1',
              rel_path: 'b.md',
              file_path: join(projectDir, 'b.md'),
              chunk_line_start: 1,
              chunk_line_end: 1,
              locator: 'line:1-1',
            },
          },
        ],
        invertedResults: [],
      }) as any,
    });

    const result = await search({
      query: '测试',
      scope: projectDir,
      top_k: 2,
    });

    expect(result.results).toHaveLength(2);
    expect(result.results[0].chunk_id).toBe('f1:0000');
    expect(result.results[1].chunk_id).toBe('f2:0000');
    expect(new Set(result.results.map((item: any) => item.source.file_path)).size).toBe(2);
  });
});

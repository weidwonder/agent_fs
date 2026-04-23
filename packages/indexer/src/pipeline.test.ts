import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IndexPipeline } from './pipeline';

function makeStorage(overrides?: {
  vector?: Record<string, unknown>;
  archive?: Record<string, unknown>;
  invertedIndex?: Record<string, unknown>;
  clue?: Record<string, unknown>;
}) {
  return {
    vector: {
      addDocuments: vi.fn().mockResolvedValue(undefined),
      deleteByFileId: vi.fn().mockResolvedValue(undefined),
      deleteByDirId: vi.fn().mockResolvedValue(undefined),
      ...overrides?.vector,
    },
    archive: {
      write: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(false),
      delete: vi.fn().mockResolvedValue(undefined),
      ...overrides?.archive,
    },
    invertedIndex: {
      addFile: vi.fn().mockResolvedValue(undefined),
      removeFile: vi.fn().mockResolvedValue(undefined),
      removeDirectory: vi.fn().mockResolvedValue(undefined),
      ...overrides?.invertedIndex,
    },
    clue: {
      removeLeavesByFileId: vi.fn().mockResolvedValue({
        affectedClues: [],
        removedLeaves: 0,
        removedFolders: 0,
      }),
      ...overrides?.clue,
    },
    init: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    metadata: {} as any,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('IndexPipeline summary mode', () => {
  it('skip 模式不应调用 summaryService 且摘要为空', async () => {
    const dirPath = mkdtempSync(join(tmpdir(), 'agent-fs-'));
    const filePath = join(dirPath, 'test.md');
    writeFileSync(filePath, '# 标题\n\n内容');

    const plugin = {
      toMarkdown: async () => ({ markdown: '# 标题\n\n内容', mapping: [] }),
    };
    const pluginManager = {
      getSupportedExtensions: () => ['md'],
      getPlugin: () => plugin,
    };

    const summaryService = {
      generateDocumentSummary: vi.fn(),
      generateDirectorySummary: vi.fn(),
    };

    const embeddingService = {
      embed: vi.fn().mockResolvedValue([0, 0, 0]),
    };

    const storage = makeStorage();

    const pipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      storage: storage as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
      },
    });

    const metadata = await pipeline.run();

    expect(summaryService.generateDocumentSummary).not.toHaveBeenCalled();
    expect(summaryService.generateDirectorySummary).not.toHaveBeenCalled();

    expect(storage.archive.write).toHaveBeenCalledTimes(1);
    const afdPayload = (storage.archive.write.mock.calls[0][1] as { files: Record<string, string> })
      .files;
    const summaries = JSON.parse(afdPayload['summaries.json']) as { documentSummary: string };
    expect(summaries.documentSummary).toBe('');

    expect(storage.invertedIndex.addFile).toHaveBeenCalledTimes(1);
    const invertedEntries = storage.invertedIndex.addFile.mock.calls[0][2] as Array<{
      text: string;
      chunkId: string;
      locator: string;
    }>;
    expect(invertedEntries.length).toBeGreaterThan(0);
    expect(invertedEntries[0].text).toContain('标题');

    expect(storage.vector.addDocuments).toHaveBeenCalledTimes(1);
    const vectorDocs = storage.vector.addDocuments.mock.calls[0][0] as Array<{
      chunk_line_start?: number;
      chunk_line_end?: number;
      content_vector?: number[];
    }>;
    expect(vectorDocs.length).toBeGreaterThan(0);
    expect(vectorDocs[0].chunk_line_start).toBeTypeOf('number');
    expect(vectorDocs[0].chunk_line_end).toBeTypeOf('number');

    expect(metadata.directorySummary).toBe('');
    expect(metadata.files[0]).not.toHaveProperty('chunkIds');

    rmSync(dirPath, { recursive: true, force: true });
  });

  it('应优先使用 searchableText 构建倒排索引', async () => {
    const dirPath = mkdtempSync(join(tmpdir(), 'agent-fs-searchable-text-'));
    const filePath = join(dirPath, 'sheet.md');
    writeFileSync(filePath, '# 表格\n\n行一\n行二');

    const plugin = {
      toMarkdown: async () => ({
        markdown: '# 表格\n\n行一\n行二',
        mapping: [],
        searchableText: [
          {
            text: '产品A 订单号123',
            markdownLine: 3,
            locator: 'sheet:Sheet1/range:A1:B10',
          },
        ],
      }),
    };
    const pluginManager = {
      getSupportedExtensions: () => ['md'],
      getPlugin: () => plugin,
    };

    const summaryService = {
      generateDocumentSummary: vi.fn(),
      generateDirectorySummary: vi.fn(),
    };

    const embeddingService = {
      embed: vi.fn().mockResolvedValue([0, 0, 0]),
    };

    const storage = makeStorage();

    const pipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      storage: storage as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
      },
    });

    await pipeline.run();

    expect(storage.invertedIndex.addFile).toHaveBeenCalledTimes(1);
    const invertedEntries = storage.invertedIndex.addFile.mock.calls[0][2] as Array<{
      text: string;
      locator: string;
      chunkId: string;
    }>;
    expect(invertedEntries).toHaveLength(1);
    expect(invertedEntries[0].text).toBe('产品A 订单号123');
    expect(invertedEntries[0].locator).toBe('sheet:Sheet1/range:A1:B10');
    expect(invertedEntries[0].chunkId).toMatch(/:0000$/);

    rmSync(dirPath, { recursive: true, force: true });
  });

  it('文件转换失败时应包含文件路径与插件信息', async () => {
    const dirPath = mkdtempSync(join(tmpdir(), 'agent-fs-convert-error-'));
    const filePath = join(dirPath, 'broken.docx');
    writeFileSync(filePath, 'broken');

    const plugin = {
      name: 'docx',
      toMarkdown: vi.fn(async () => {
        throw new Error('CONVERSION_FAILED:');
      }),
    };
    const pluginManager = {
      getSupportedExtensions: () => ['docx'],
      getPlugin: () => plugin,
    };

    const summaryService = {
      generateDocumentSummary: vi.fn(),
      generateDirectorySummary: vi.fn(),
    };

    const embeddingService = {
      embed: vi.fn().mockResolvedValue([0, 0, 0]),
    };

    const storage = makeStorage();

    const pipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      storage: storage as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
      },
    });

    let thrownMessage = '';
    try {
      await pipeline.run();
    } catch (error) {
      thrownMessage = (error as Error).message;
    }

    expect(thrownMessage).toMatch(/broken\.docx/u);
    expect(thrownMessage).toMatch(/docx/u);

    rmSync(dirPath, { recursive: true, force: true });
  });

  it('向量化超时时应记录阶段信息并写入日志', async () => {
    const dirPath = mkdtempSync(join(tmpdir(), 'agent-fs-embed-timeout-'));
    const filePath = join(dirPath, 'timeout.md');
    writeFileSync(filePath, '# 标题\n\n内容');

    const plugin = {
      name: 'markdown',
      toMarkdown: async () => ({ markdown: '# 标题\n\n内容', mapping: [] }),
    };
    const pluginManager = {
      getSupportedExtensions: () => ['md'],
      getPlugin: () => plugin,
    };

    const summaryService = {
      generateDocumentSummary: vi.fn(),
      generateDirectorySummary: vi.fn(),
    };

    const embeddingService = {
      embed: vi.fn().mockRejectedValueOnce(new Error('The operation was aborted due to timeout')),
    };

    const storage = makeStorage();

    const pipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      storage: storage as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
      },
    });

    let thrownMessage = '';
    try {
      await pipeline.run();
    } catch (error) {
      thrownMessage = (error as Error).message;
    }

    expect(thrownMessage).toMatch(/timeout\.md/u);
    expect(thrownMessage).toMatch(/\[阶段: embed\]/u);
    expect(thrownMessage).toMatch(/aborted due to timeout/u);

    const logPath = join(dirPath, '.fs_index', 'logs', 'indexing.latest.jsonl');
    expect(existsSync(logPath)).toBe(true);
    const logLines = readFileSync(logPath, 'utf-8');
    expect(logLines).toMatch(/"stage":"embed"/u);
    expect(logLines).toMatch(/"event":"stage_error"/u);

    rmSync(dirPath, { recursive: true, force: true });
  });

  it('应支持文件级并发处理', async () => {
    const dirPath = mkdtempSync(join(tmpdir(), 'agent-fs-file-parallelism-'));
    writeFileSync(join(dirPath, 'a.md'), '# A\n\ncontent');
    writeFileSync(join(dirPath, 'b.md'), '# B\n\ncontent');
    writeFileSync(join(dirPath, 'c.md'), '# C\n\ncontent');

    let running = 0;
    let maxRunning = 0;
    const plugin = {
      name: 'markdown',
      toMarkdown: vi.fn(async (filePath: string) => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 20));
        running -= 1;
        return { markdown: `# ${filePath}\n\ncontent`, mapping: [] };
      }),
    };
    const pluginManager = {
      getSupportedExtensions: () => ['md'],
      getPlugin: () => plugin,
    };

    const summaryService = {
      generateDocumentSummary: vi.fn(),
      generateDirectorySummary: vi.fn(),
    };

    const embeddingService = {
      embed: vi.fn().mockResolvedValue([0, 0, 0]),
    };

    const storage = makeStorage();

    const pipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      storage: storage as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
      },
      fileParallelism: 2,
    } as any);

    await pipeline.run();

    expect(plugin.toMarkdown).toHaveBeenCalledTimes(3);
    expect(maxRunning).toBeGreaterThan(1);

    rmSync(dirPath, { recursive: true, force: true });
  });

  it('应递归索引子目录并写入层级 metadata', async () => {
    const dirPath = mkdtempSync(join(tmpdir(), 'agent-fs-tree-'));
    mkdirSync(join(dirPath, 'docs', 'nested'), { recursive: true });

    writeFileSync(join(dirPath, 'root.md'), '# Root\n\nRoot content');
    writeFileSync(join(dirPath, 'docs', 'a.md'), '# A\n\nA content');
    writeFileSync(join(dirPath, 'docs', 'nested', 'b.md'), '# B\n\nB content');

    const plugin = {
      toMarkdown: async (filePath: string) => ({ markdown: `# ${filePath}\n\n内容`, mapping: [] }),
    };
    const pluginManager = {
      getSupportedExtensions: () => ['md'],
      getPlugin: () => plugin,
    };

    const summaryService = {
      generateDocumentSummary: vi.fn(),
      generateDirectorySummary: vi.fn().mockResolvedValue({ summary: '' }),
    };

    const embeddingService = {
      embed: vi.fn().mockResolvedValue([0, 0, 0]),
    };

    const storage = makeStorage();

    const pipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      storage: storage as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
      },
    });

    const metadata = await pipeline.run();
    expect(metadata.projectId).toBe(metadata.dirId);
    expect(metadata.relativePath).toBe('.');
    expect(metadata.parentDirId).toBeNull();
    expect(metadata.stats.fileCount).toBe(3);

    const docsIndexPath = join(dirPath, 'docs', '.fs_index', 'index.json');
    const nestedIndexPath = join(dirPath, 'docs', 'nested', '.fs_index', 'index.json');
    expect(existsSync(docsIndexPath)).toBe(true);
    expect(existsSync(nestedIndexPath)).toBe(true);

    const docsMeta = JSON.parse(readFileSync(docsIndexPath, 'utf-8')) as {
      dirId: string;
      projectId: string;
      relativePath: string;
      parentDirId: string | null;
      stats: { fileCount: number };
    };
    expect(docsMeta.projectId).toBe(metadata.projectId);
    expect(docsMeta.relativePath).toBe('docs');
    expect(docsMeta.parentDirId).toBe(metadata.dirId);
    expect(docsMeta.stats.fileCount).toBe(2);

    const nestedMeta = JSON.parse(readFileSync(nestedIndexPath, 'utf-8')) as {
      projectId: string;
      relativePath: string;
      parentDirId: string | null;
      stats: { fileCount: number };
    };
    expect(nestedMeta.projectId).toBe(metadata.projectId);
    expect(nestedMeta.relativePath).toBe('docs/nested');
    expect(nestedMeta.parentDirId).toBe(docsMeta.dirId);
    expect(nestedMeta.stats.fileCount).toBe(1);

    const docsSummary = metadata.subdirectories.find((item) => item.name === 'docs');
    expect(docsSummary?.hasIndex).toBe(true);
    expect(docsSummary?.fileCount).toBe(2);
    expect(typeof docsSummary?.dirId).toBe('string');

    rmSync(dirPath, { recursive: true, force: true });
  });

  it('增量索引应跳过未变更文件', async () => {
    const dirPath = mkdtempSync(join(tmpdir(), 'agent-fs-incremental-'));
    writeFileSync(join(dirPath, 'stable.md'), '# Stable\n\ncontent');

    const toMarkdown = vi.fn(async () => ({ markdown: '# Stable\n\ncontent', mapping: [] }));
    const plugin = { toMarkdown };
    const pluginManager = {
      getSupportedExtensions: () => ['md'],
      getPlugin: () => plugin,
    };

    const summaryService = {
      generateDocumentSummary: vi.fn(),
      generateDirectorySummary: vi.fn().mockResolvedValue({ summary: '' }),
    };

    const embeddingService = {
      embed: vi.fn().mockResolvedValue([0, 0, 0]),
    };

    const storage = makeStorage();

    const firstPipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      storage: storage as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
      },
    });
    await firstPipeline.run();

    toMarkdown.mockClear();
    storage.vector.addDocuments.mockClear();
    storage.archive.write.mockClear();
    storage.invertedIndex.addFile.mockClear();
    // Simulate that the archive was written during the first run
    storage.archive.exists.mockResolvedValue(true);

    const secondPipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      storage: storage as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
      },
    });
    await secondPipeline.run();

    expect(toMarkdown).not.toHaveBeenCalled();
    expect(storage.vector.addDocuments).not.toHaveBeenCalled();
    expect(storage.archive.write).not.toHaveBeenCalled();
    expect(storage.invertedIndex.addFile).not.toHaveBeenCalled();

    rmSync(dirPath, { recursive: true, force: true });
  });

  it('首次索引中断后应跳过已写入 AFD 的未变更文件', async () => {
    const dirPath = mkdtempSync(join(tmpdir(), 'agent-fs-resume-afd-'));
    writeFileSync(join(dirPath, 'a.md'), '# A\n\ncontent');
    writeFileSync(join(dirPath, 'b.md'), '# B\n\ncontent');

    let callCount = 0;
    let failOnSecondCall = true;
    const toMarkdown = vi.fn(async (filePath: string) => {
      callCount += 1;
      if (failOnSecondCall && callCount === 2) {
        throw new Error('模拟中断');
      }
      return { markdown: `# ${filePath}\n\ncontent`, mapping: [] };
    });
    const plugin = { toMarkdown };
    const pluginManager = {
      getSupportedExtensions: () => ['md'],
      getPlugin: () => plugin,
    };

    const summaryService = {
      generateDocumentSummary: vi.fn(),
      generateDirectorySummary: vi.fn().mockResolvedValue({ summary: '' }),
    };

    const embeddingService = {
      embed: vi.fn().mockResolvedValue([0, 0, 0]),
    };

    const archivedNames = new Set<string>();
    const storage = makeStorage({
      archive: {
        write: vi.fn().mockImplementation(async (archiveName: string) => {
          archivedNames.add(archiveName);
        }),
        exists: vi
          .fn()
          .mockImplementation(async (archiveName: string) => archivedNames.has(archiveName)),
        delete: vi.fn().mockImplementation(async (archiveName: string) => {
          archivedNames.delete(archiveName);
        }),
      },
    });

    const firstPipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      storage: storage as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
      },
    });
    await expect(firstPipeline.run()).rejects.toThrow(/模拟中断/u);
    expect(existsSync(join(dirPath, '.fs_index', 'index.json'))).toBe(false);
    expect(archivedNames.size).toBe(1);

    failOnSecondCall = false;
    toMarkdown.mockClear();
    storage.vector.addDocuments.mockClear();
    storage.archive.write.mockClear();
    storage.invertedIndex.addFile.mockClear();

    const secondPipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      storage: storage as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
      },
    });
    const metadata = await secondPipeline.run();

    expect(toMarkdown).toHaveBeenCalledTimes(1);
    expect(storage.vector.addDocuments).toHaveBeenCalledTimes(1);
    expect(storage.archive.write).toHaveBeenCalledTimes(1);
    expect(storage.invertedIndex.addFile).toHaveBeenCalledTimes(1);
    expect(metadata.files).toHaveLength(2);

    rmSync(dirPath, { recursive: true, force: true });
  });

  it('增量索引应仅重建变更文件并清理旧数据', async () => {
    const dirPath = mkdtempSync(join(tmpdir(), 'agent-fs-incremental-change-'));
    const filePath = join(dirPath, 'update.md');
    writeFileSync(filePath, '# V1\n\ncontent');

    const toMarkdown = vi.fn(async () => ({ markdown: '# V1\n\ncontent', mapping: [] }));
    const plugin = { toMarkdown };
    const pluginManager = {
      getSupportedExtensions: () => ['md'],
      getPlugin: () => plugin,
    };

    const summaryService = {
      generateDocumentSummary: vi.fn(),
      generateDirectorySummary: vi.fn().mockResolvedValue({ summary: '' }),
    };

    const embeddingService = {
      embed: vi.fn().mockResolvedValue([0, 0, 0]),
    };

    const storage = makeStorage();

    const firstPipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      storage: storage as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
      },
    });
    await firstPipeline.run();

    const firstMetadata = JSON.parse(
      readFileSync(join(dirPath, '.fs_index', 'index.json'), 'utf-8')
    ) as {
      files: Array<{ fileId: string }>;
    };
    const oldFileId = firstMetadata.files[0].fileId;

    toMarkdown.mockClear();
    storage.vector.addDocuments.mockClear();
    storage.vector.deleteByFileId.mockClear();
    storage.archive.write.mockClear();
    storage.archive.delete.mockClear();
    storage.invertedIndex.addFile.mockClear();
    storage.invertedIndex.removeFile.mockClear();

    writeFileSync(filePath, '# V2\n\ncontent changed');

    const secondPipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      storage: storage as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
      },
    });
    await secondPipeline.run();

    expect(toMarkdown).toHaveBeenCalledTimes(1);
    expect(storage.vector.addDocuments).toHaveBeenCalledTimes(1);
    expect(storage.archive.write).toHaveBeenCalledTimes(1);
    expect(storage.vector.deleteByFileId).toHaveBeenCalledWith(oldFileId);
    expect(storage.archive.delete).toHaveBeenCalledWith('update.md');
    expect(storage.invertedIndex.removeFile).toHaveBeenCalledWith(oldFileId);
    expect(storage.invertedIndex.addFile).toHaveBeenCalledTimes(1);
    expect(storage.clue.removeLeavesByFileId).not.toHaveBeenCalled();

    rmSync(dirPath, { recursive: true, force: true });
  });

  it('删除子目录后应清理孤儿 AFD 文档', async () => {
    const dirPath = mkdtempSync(join(tmpdir(), 'agent-fs-incremental-dir-remove-'));
    const docsPath = join(dirPath, 'docs');
    mkdirSync(docsPath, { recursive: true });
    writeFileSync(join(docsPath, 'a.md'), '# A\n\ncontent');

    const plugin = {
      toMarkdown: vi.fn(async () => ({ markdown: '# A\n\ncontent', mapping: [] })),
    };
    const pluginManager = {
      getSupportedExtensions: () => ['md'],
      getPlugin: () => plugin,
    };

    const summaryService = {
      generateDocumentSummary: vi.fn(),
      generateDirectorySummary: vi.fn().mockResolvedValue({ summary: '' }),
    };

    const embeddingService = {
      embed: vi.fn().mockResolvedValue([0, 0, 0]),
    };

    const storage = makeStorage();

    const firstPipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      storage: storage as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
      },
    });
    await firstPipeline.run();

    const staleAfdPath = join(dirPath, 'docs', '.fs_index', 'documents', 'a.md.afd');
    mkdirSync(join(dirPath, 'docs', '.fs_index', 'documents'), { recursive: true });
    writeFileSync(staleAfdPath, 'stale');

    rmSync(docsPath, { recursive: true, force: true });
    expect(existsSync(docsPath)).toBe(false);

    const secondPipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      storage: storage as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
      },
    });
    await secondPipeline.run();

    expect(storage.archive.delete).toHaveBeenCalledWith('a.md');
    expect(storage.clue.removeLeavesByFileId).toHaveBeenCalledTimes(1);

    if (existsSync(staleAfdPath)) {
      unlinkSync(staleAfdPath);
    }
    rmSync(dirPath, { recursive: true, force: true });
  });

  it('删除文件时应同步清理 Clue 引用', async () => {
    const dirPath = mkdtempSync(join(tmpdir(), 'agent-fs-clue-delete-sync-'));
    mkdirSync(join(dirPath, '.fs_index'), { recursive: true });
    writeFileSync(
      join(dirPath, '.fs_index', 'index.json'),
      JSON.stringify(
        {
          version: '2.0',
          createdAt: '2026-04-23T00:00:00.000Z',
          updatedAt: '2026-04-23T00:00:00.000Z',
          dirId: 'project-delete',
          directoryPath: dirPath,
          directorySummary: '',
          projectId: 'project-delete',
          relativePath: '.',
          parentDirId: null,
          stats: { fileCount: 1, chunkCount: 1, totalTokens: 10 },
          files: [
            {
              name: 'gone.md',
              afdName: 'gone.md',
              type: 'md',
              size: 10,
              hash: 'hash-old',
              fileId: 'file-delete',
              indexedAt: '2026-04-23T00:00:00.000Z',
              chunkCount: 1,
              summary: '',
            },
          ],
          subdirectories: [],
          unsupportedFiles: [],
        },
        null,
        2
      )
    );

    const pluginManager = {
      getSupportedExtensions: () => ['md'],
      getPlugin: () => null,
    };
    const summaryService = {
      generateDocumentSummary: vi.fn(),
      generateDirectorySummary: vi.fn(),
    };
    const embeddingService = {
      embed: vi.fn().mockResolvedValue([0, 0, 0]),
    };
    const storage = makeStorage();

    const pipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      storage: storage as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
      },
    });

    await pipeline.run();

    expect(storage.vector.deleteByFileId).toHaveBeenCalledWith('file-delete');
    expect(storage.invertedIndex.removeFile).toHaveBeenCalledWith('file-delete');
    expect(storage.clue.removeLeavesByFileId).toHaveBeenCalledWith('project-delete', 'file-delete');

    rmSync(dirPath, { recursive: true, force: true });
  });

  it('新增或修改文件后应异步发送 Clue Webhook', async () => {
    const dirPath = mkdtempSync(join(tmpdir(), 'agent-fs-clue-webhook-'));
    writeFileSync(join(dirPath, 'new.md'), '# 新文档\n\n内容');

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });
    vi.stubGlobal('fetch', fetchSpy);

    const plugin = {
      name: 'markdown',
      toMarkdown: vi.fn(async () => ({ markdown: '# 新文档\n\n内容', mapping: [] })),
    };
    const pluginManager = {
      getSupportedExtensions: () => ['md'],
      getPlugin: () => plugin,
    };
    const summaryService = {
      generateDocumentSummary: vi.fn(),
      generateDirectorySummary: vi.fn(),
    };
    const embeddingService = {
      embed: vi.fn().mockResolvedValue([0, 0, 0]),
    };
    const storage = makeStorage();

    const pipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      storage: storage as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
      },
      clueConfig: {
        webhook_url: 'http://127.0.0.1:3000/clue-webhook',
        webhook_secret: 'test-secret',
      },
    });

    await pipeline.run();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    const [url, requestInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(requestInit.body)) as {
      event: string;
      project_id: string;
      project_path: string;
      changes: Array<{ file_path: string; action: string; summary: string }>;
    };
    const headers = requestInit.headers as Record<string, string>;

    expect(url).toBe('http://127.0.0.1:3000/clue-webhook');
    expect(payload.event).toBe('documents_changed');
    expect(payload.project_path).toBe(dirPath);
    expect(payload.project_id).toBeTruthy();
    expect(payload.changes).toHaveLength(1);
    expect(payload.changes[0]).toMatchObject({
      file_path: 'new.md',
      action: 'added',
      summary: '',
    });
    expect(headers['X-Webhook-Signature']).toMatch(/^sha256=/u);

    rmSync(dirPath, { recursive: true, force: true });
  });
});

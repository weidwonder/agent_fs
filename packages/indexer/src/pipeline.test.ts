import { describe, expect, it, vi } from 'vitest';
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
      generateChunkSummariesBatch: vi.fn(),
      generateChunkSummary: vi.fn(),
      generateDocumentSummary: vi.fn(),
      generateDirectorySummary: vi.fn(),
    };

    const embeddingService = {
      embed: vi.fn().mockResolvedValue([0, 0, 0]),
    };

    const vectorStore = {
      addDocuments: vi.fn().mockResolvedValue(undefined),
    };

    const afdStorage = {
      write: vi.fn().mockResolvedValue(undefined),
    };

    const invertedIndex = {
      addFile: vi.fn().mockResolvedValue(undefined),
    };

    const pipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      vectorStore: vectorStore as any,
      afdStorage: afdStorage as any,
      invertedIndex: invertedIndex as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
        tokenBudget: 10000,
      },
    });

    const metadata = await pipeline.run();

    expect(summaryService.generateChunkSummariesBatch).not.toHaveBeenCalled();
    expect(summaryService.generateChunkSummary).not.toHaveBeenCalled();
    expect(summaryService.generateDocumentSummary).not.toHaveBeenCalled();
    expect(summaryService.generateDirectorySummary).not.toHaveBeenCalled();

    expect(afdStorage.write).toHaveBeenCalledTimes(1);
    const afdPayload = afdStorage.write.mock.calls[0][1] as Record<string, string>;
    const summaries = JSON.parse(afdPayload['summaries.json']) as Record<string, string>;
    expect(Object.values(summaries).every((item) => item === '')).toBe(true);

    expect(invertedIndex.addFile).toHaveBeenCalledTimes(1);
    const invertedEntries = invertedIndex.addFile.mock.calls[0][2] as Array<{
      text: string;
      chunkId: string;
      locator: string;
    }>;
    expect(invertedEntries.length).toBeGreaterThan(0);
    expect(invertedEntries[0].text).toContain('标题');

    expect(vectorStore.addDocuments).toHaveBeenCalledTimes(1);
    const vectorDocs = vectorStore.addDocuments.mock.calls[0][0] as Array<{
      content?: string;
      summary?: string;
      chunk_line_start?: number;
      chunk_line_end?: number;
    }>;
    expect(vectorDocs.length).toBeGreaterThan(0);
    expect(vectorDocs[0].content).toBeUndefined();
    expect(vectorDocs[0].summary).toBeUndefined();
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
      generateChunkSummariesBatch: vi.fn(),
      generateChunkSummary: vi.fn(),
      generateDocumentSummary: vi.fn(),
      generateDirectorySummary: vi.fn(),
    };

    const embeddingService = {
      embed: vi.fn().mockResolvedValue([0, 0, 0]),
    };

    const vectorStore = {
      addDocuments: vi.fn().mockResolvedValue(undefined),
    };

    const afdStorage = {
      write: vi.fn().mockResolvedValue(undefined),
    };

    const invertedIndex = {
      addFile: vi.fn().mockResolvedValue(undefined),
    };

    const pipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      vectorStore: vectorStore as any,
      afdStorage: afdStorage as any,
      invertedIndex: invertedIndex as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
        tokenBudget: 10000,
      },
    });

    await pipeline.run();

    expect(invertedIndex.addFile).toHaveBeenCalledTimes(1);
    const invertedEntries = invertedIndex.addFile.mock.calls[0][2] as Array<{
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
      generateChunkSummariesBatch: vi.fn().mockResolvedValue([{ summary: '' }]),
      generateChunkSummary: vi.fn(),
      generateDocumentSummary: vi.fn(),
      generateDirectorySummary: vi.fn().mockResolvedValue({ summary: '' }),
    };

    const embeddingService = {
      embed: vi.fn().mockResolvedValue([0, 0, 0]),
    };

    const vectorStore = {
      addDocuments: vi.fn().mockResolvedValue(undefined),
    };

    const afdStorage = {
      write: vi.fn().mockResolvedValue(undefined),
    };

    const invertedIndex = {
      addFile: vi.fn().mockResolvedValue(undefined),
    };

    const pipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      vectorStore: vectorStore as any,
      afdStorage: afdStorage as any,
      invertedIndex: invertedIndex as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
        tokenBudget: 10000,
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
      generateChunkSummariesBatch: vi.fn().mockResolvedValue([{ summary: '' }]),
      generateChunkSummary: vi.fn(),
      generateDocumentSummary: vi.fn(),
      generateDirectorySummary: vi.fn().mockResolvedValue({ summary: '' }),
    };

    const embeddingService = {
      embed: vi.fn().mockResolvedValue([0, 0, 0]),
    };

    const vectorStore = {
      addDocuments: vi.fn().mockResolvedValue(undefined),
      deleteByFileId: vi.fn().mockResolvedValue(undefined),
      deleteByDirId: vi.fn().mockResolvedValue(undefined),
    };

    const afdStorage = {
      write: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const invertedIndex = {
      addFile: vi.fn().mockResolvedValue(undefined),
      removeFile: vi.fn().mockResolvedValue(undefined),
      removeDirectory: vi.fn().mockResolvedValue(undefined),
    };

    const firstPipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      vectorStore: vectorStore as any,
      afdStorage: afdStorage as any,
      invertedIndex: invertedIndex as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
        tokenBudget: 10000,
      },
    });
    await firstPipeline.run();

    toMarkdown.mockClear();
    vectorStore.addDocuments.mockClear();
    afdStorage.write.mockClear();
    invertedIndex.addFile.mockClear();

    const secondPipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      vectorStore: vectorStore as any,
      afdStorage: afdStorage as any,
      invertedIndex: invertedIndex as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
        tokenBudget: 10000,
      },
    });
    await secondPipeline.run();

    expect(toMarkdown).not.toHaveBeenCalled();
    expect(vectorStore.addDocuments).not.toHaveBeenCalled();
    expect(afdStorage.write).not.toHaveBeenCalled();
    expect(invertedIndex.addFile).not.toHaveBeenCalled();

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
      generateChunkSummariesBatch: vi.fn().mockResolvedValue([{ summary: '' }]),
      generateChunkSummary: vi.fn(),
      generateDocumentSummary: vi.fn(),
      generateDirectorySummary: vi.fn().mockResolvedValue({ summary: '' }),
    };

    const embeddingService = {
      embed: vi.fn().mockResolvedValue([0, 0, 0]),
    };

    const vectorStore = {
      addDocuments: vi.fn().mockResolvedValue(undefined),
      deleteByFileId: vi.fn().mockResolvedValue(undefined),
      deleteByDirId: vi.fn().mockResolvedValue(undefined),
    };

    const afdStorage = {
      write: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const invertedIndex = {
      addFile: vi.fn().mockResolvedValue(undefined),
      removeFile: vi.fn().mockResolvedValue(undefined),
      removeDirectory: vi.fn().mockResolvedValue(undefined),
    };

    const firstPipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      vectorStore: vectorStore as any,
      afdStorage: afdStorage as any,
      invertedIndex: invertedIndex as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
        tokenBudget: 10000,
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
    vectorStore.addDocuments.mockClear();
    vectorStore.deleteByFileId.mockClear();
    afdStorage.write.mockClear();
    afdStorage.delete.mockClear();
    invertedIndex.addFile.mockClear();
    invertedIndex.removeFile.mockClear();

    writeFileSync(filePath, '# V2\n\ncontent changed');

    const secondPipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      vectorStore: vectorStore as any,
      afdStorage: afdStorage as any,
      invertedIndex: invertedIndex as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
        tokenBudget: 10000,
      },
    });
    await secondPipeline.run();

    expect(toMarkdown).toHaveBeenCalledTimes(1);
    expect(vectorStore.addDocuments).toHaveBeenCalledTimes(1);
    expect(afdStorage.write).toHaveBeenCalledTimes(1);
    expect(vectorStore.deleteByFileId).toHaveBeenCalledWith(oldFileId);
    expect(afdStorage.delete).toHaveBeenCalledWith(oldFileId);
    expect(invertedIndex.removeFile).toHaveBeenCalledWith(oldFileId);
    expect(invertedIndex.addFile).toHaveBeenCalledTimes(1);

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
      generateChunkSummariesBatch: vi.fn().mockResolvedValue([{ summary: '' }]),
      generateChunkSummary: vi.fn(),
      generateDocumentSummary: vi.fn(),
      generateDirectorySummary: vi.fn().mockResolvedValue({ summary: '' }),
    };

    const embeddingService = {
      embed: vi.fn().mockResolvedValue([0, 0, 0]),
    };

    const vectorStore = {
      addDocuments: vi.fn().mockResolvedValue(undefined),
      deleteByFileId: vi.fn().mockResolvedValue(undefined),
      deleteByDirId: vi.fn().mockResolvedValue(undefined),
    };

    const afdStorage = {
      write: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const invertedIndex = {
      addFile: vi.fn().mockResolvedValue(undefined),
      removeFile: vi.fn().mockResolvedValue(undefined),
      removeDirectory: vi.fn().mockResolvedValue(undefined),
    };

    const firstPipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      vectorStore: vectorStore as any,
      afdStorage: afdStorage as any,
      invertedIndex: invertedIndex as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
        tokenBudget: 10000,
      },
    });
    await firstPipeline.run();

    const childMetadata = JSON.parse(
      readFileSync(join(dirPath, 'docs', '.fs_index', 'index.json'), 'utf-8')
    ) as {
      files: Array<{ fileId: string }>;
    };
    const staleFileId = childMetadata.files[0].fileId;
    const staleAfdPath = join(dirPath, '.fs_index', 'documents', `${staleFileId}.afd`);
    writeFileSync(staleAfdPath, 'stale');

    rmSync(docsPath, { recursive: true, force: true });
    expect(existsSync(docsPath)).toBe(false);

    const secondPipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      vectorStore: vectorStore as any,
      afdStorage: afdStorage as any,
      invertedIndex: invertedIndex as any,
      chunkOptions: { minTokens: 1, maxTokens: 200 },
      summaryOptions: {
        mode: 'skip',
        tokenBudget: 10000,
      },
    });
    await secondPipeline.run();

    expect(afdStorage.delete).toHaveBeenCalledWith(staleFileId);

    if (existsSync(staleAfdPath)) {
      unlinkSync(staleAfdPath);
    }
    rmSync(dirPath, { recursive: true, force: true });
  });
});

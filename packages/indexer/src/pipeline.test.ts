import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

    const bm25Index = {
      addDocuments: vi.fn(),
    };

    const pipeline = new IndexPipeline({
      dirPath,
      pluginManager: pluginManager as any,
      embeddingService: embeddingService as any,
      summaryService: summaryService as any,
      vectorStore: vectorStore as any,
      bm25Index: bm25Index as any,
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

    const summaryPath = join(dirPath, '.fs_index', 'documents', 'test.md', 'summary.json');
    const summaryData = JSON.parse(readFileSync(summaryPath, 'utf-8')) as {
      document: string;
      chunks: string[];
    };

    expect(summaryData.document).toBe('');
    expect(summaryData.chunks.every((chunk) => chunk === '')).toBe(true);
    expect(metadata.directorySummary).toBe('');

    rmSync(dirPath, { recursive: true, force: true });
  });
});

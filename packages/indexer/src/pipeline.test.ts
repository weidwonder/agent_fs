import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

    expect(metadata.directorySummary).toBe('');

    rmSync(dirPath, { recursive: true, force: true });
  });
});

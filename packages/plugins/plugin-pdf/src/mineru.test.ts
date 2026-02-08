import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertPDFWithMinerU } from './mineru';

const mockInitialize = vi.fn(async () => undefined);
const mockParseFile = vi.fn(async () => ({
  metadata: { totalPages: 2 },
}));
const mockResultToMarkdown = vi.fn(() => '# 标题');
const mockResultToContentList = vi.fn(() => [{ page_idx: 0, text: '第一页' }]);

vi.mock('mineru-ts', () => ({
  MinerUClient: class {
    constructor(public readonly _options: unknown) {
      if (typeof (globalThis as Record<string, unknown>).File === 'undefined') {
        throw new Error('File is not defined');
      }
    }

    initialize = mockInitialize;
    parseFile = mockParseFile;
    resultToMarkdown = mockResultToMarkdown;
    resultToContentList = mockResultToContentList;
  },
}));

describe('convertPDFWithMinerU', () => {
  const originalFile = (globalThis as Record<string, unknown>).File;

  afterEach(() => {
    const globalRecord = globalThis as Record<string, unknown>;
    if (originalFile === undefined) {
      delete globalRecord.File;
    } else {
      globalRecord.File = originalFile;
    }

    mockInitialize.mockClear();
    mockParseFile.mockClear();
    mockResultToMarkdown.mockClear();
    mockResultToContentList.mockClear();
  });

  it('应在 File 缺失时自动补齐并完成转换', async () => {
    const globalRecord = globalThis as Record<string, unknown>;
    delete globalRecord.File;

    const result = await convertPDFWithMinerU('/tmp/sample.pdf', {
      serverUrl: 'http://127.0.0.1:30000',
    } as any);

    expect(typeof globalRecord.File).toBe('function');
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockParseFile).toHaveBeenCalledWith('/tmp/sample.pdf');
    expect(result.markdown).toBe('# 标题');
    expect(result.totalPages).toBe(2);
    expect(result.contentList).toEqual([{ page_idx: 0, text: '第一页' }]);
  });
});

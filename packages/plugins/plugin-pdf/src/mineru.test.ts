import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertPDFWithMinerU } from './mineru';

const mockInitialize = vi.fn();
const mockParseFile = vi.fn();
const mockResultToMarkdown = vi.fn();
const mockResultToContentList = vi.fn();

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

  beforeEach(() => {
    mockInitialize.mockReset();
    mockInitialize.mockResolvedValue(undefined);
    mockParseFile.mockReset();
    mockParseFile.mockResolvedValue({
      metadata: { totalPages: 2 },
    });
    mockResultToMarkdown.mockReset();
    mockResultToMarkdown.mockReturnValue('# 标题');
    mockResultToContentList.mockReset();
    mockResultToContentList.mockReturnValue([{ page_idx: 0, text: '第一页' }]);
  });

  afterEach(() => {
    const globalRecord = globalThis as Record<string, unknown>;
    if (originalFile === undefined) {
      delete globalRecord.File;
    } else {
      globalRecord.File = originalFile;
    }
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

  it('应在 VLM 空响应时重试整个 parseFile', async () => {
    mockParseFile
      .mockRejectedValueOnce(new Error('Empty response from VLM server'))
      .mockResolvedValueOnce({
        metadata: { totalPages: 3 },
      });
    mockResultToMarkdown.mockReturnValueOnce('# 重试成功');
    mockResultToContentList.mockReturnValueOnce([{ page_idx: 1, text: '第二页' }]);

    const result = await convertPDFWithMinerU('/tmp/retry.pdf', {
      serverUrl: 'http://127.0.0.1:30000',
    } as any);

    expect(mockParseFile).toHaveBeenCalledTimes(2);
    expect(result.markdown).toBe('# 重试成功');
    expect(result.totalPages).toBe(3);
    expect(result.contentList).toEqual([{ page_idx: 1, text: '第二页' }]);
  });

  it('非空响应错误不应额外重试', async () => {
    mockParseFile.mockRejectedValueOnce(new Error('VLM request failed (500): internal error'));

    await expect(
      convertPDFWithMinerU('/tmp/no-retry.pdf', {
        serverUrl: 'http://127.0.0.1:30000',
      } as any)
    ).rejects.toThrow('internal error');

    expect(mockParseFile).toHaveBeenCalledTimes(1);
  });
});

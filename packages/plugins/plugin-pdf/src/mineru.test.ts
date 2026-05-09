import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertPDFWithMinerU } from './mineru';

const mockInitialize = vi.fn();
const mockParseFile = vi.fn();
const mockResultToMarkdown = vi.fn();
const mockResultToContentList = vi.fn();
const createdClientOptions: Record<string, unknown>[] = [];

vi.mock('mineru-ts', () => ({
  MinerUClient: class {
    constructor(public readonly _options: unknown) {
      createdClientOptions.push((this._options ?? {}) as Record<string, unknown>);
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
    createdClientOptions.length = 0;
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
    });

    expect(typeof globalRecord.File).toBe('function');
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockParseFile).toHaveBeenCalledWith('/tmp/sample.pdf');
    expect(createdClientOptions[0]?.maxConcurrency).toBe(4);
    expect(createdClientOptions[0]?.pageConcurrency).toBe(2);
    expect(createdClientOptions[0]?.cropImageFormat).toBe('png');
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
    });

    expect(mockParseFile).toHaveBeenCalledTimes(2);
    expect(createdClientOptions.map((option) => option.maxConcurrency)).toEqual([4, 2]);
    expect(result.markdown).toBe('# 重试成功');
    expect(result.totalPages).toBe(3);
    expect(result.contentList).toEqual([{ page_idx: 1, text: '第二页' }]);
  });

  it('应在网络异常时重试整个 parseFile', async () => {
    mockParseFile
      .mockRejectedValueOnce(new Error('connect EHOSTDOWN 10.0.0.8:30000'))
      .mockResolvedValueOnce({
        metadata: { totalPages: 1 },
      });
    mockResultToMarkdown.mockReturnValueOnce('# 网络重试成功');
    mockResultToContentList.mockReturnValueOnce([{ page_idx: 0, text: '第一页' }]);

    const result = await convertPDFWithMinerU('/tmp/network-retry.pdf', {
      serverUrl: 'http://127.0.0.1:30000',
    });

    expect(mockParseFile).toHaveBeenCalledTimes(2);
    expect(result.markdown).toBe('# 网络重试成功');
  });

  it('非可重试错误不应额外重试', async () => {
    mockParseFile.mockRejectedValueOnce(new Error('VLM request failed (500): internal error'));

    await expect(
      convertPDFWithMinerU('/tmp/no-retry.pdf', {
        serverUrl: 'http://127.0.0.1:30000',
      })
    ).rejects.toThrow('internal error');

    expect(mockParseFile).toHaveBeenCalledTimes(1);
  });

  it('应将 mineru-ts 内建页级控制配置透传给客户端', async () => {
    await convertPDFWithMinerU('/tmp/page-options.pdf', {
      serverUrl: 'http://127.0.0.1:30000',
      maxConcurrency: 6,
      pageConcurrency: 2,
      pageRetryLimit: 1,
      skipFailedPages: false,
      cropImageFormat: 'jpeg',
      cropImageQuality: 0.8,
      keepAlive: false,
    });

    expect(createdClientOptions[0]).toMatchObject({
      serverUrl: 'http://127.0.0.1:30000',
      maxConcurrency: 6,
      pageConcurrency: 2,
      pageRetryLimit: 1,
      skipFailedPages: false,
      cropImageFormat: 'jpeg',
      cropImageQuality: 0.8,
      keepAlive: false,
    });
  });
});

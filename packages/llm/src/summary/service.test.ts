import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LLMConfig } from '@agent-fs/core';
import { SummaryCache } from './cache';
import { SummaryService } from './service';

type MockFetch = ReturnType<typeof vi.fn>;

const baseConfig: LLMConfig = {
  provider: 'openai-compatible',
  base_url: 'https://example.com/v1',
  api_key: 'sk-test',
  model: 'gpt-4o-mini',
};

const createOkResponse = (content: string) => ({
  ok: true,
  json: async () => ({
    choices: [{ message: { content } }],
  }),
});

const createErrorResponse = (status = 500) => ({
  ok: false,
  status,
  json: async () => ({ message: 'error' }),
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('SummaryCache', () => {
  it('应能根据内容与类型缓存摘要', () => {
    const cache = new SummaryCache('test-model', 10);

    expect(cache.get('内容', 'chunk')).toBeUndefined();

    cache.set('内容', 'chunk', '摘要A');

    expect(cache.get('内容', 'chunk')).toBe('摘要A');
    expect(cache.get('内容', 'document')).toBeUndefined();
  });

  it('clear 应清空缓存', () => {
    const cache = new SummaryCache('test-model', 10);
    cache.set('内容', 'chunk', '摘要A');

    cache.clear();

    expect(cache.get('内容', 'chunk')).toBeUndefined();
  });
});

describe('SummaryService', () => {
  it('chunk 摘要应命中缓存', async () => {
    const fetchMock: MockFetch = vi.fn().mockResolvedValue(createOkResponse('摘要'));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const service = new SummaryService(baseConfig);

    const first = await service.generateChunkSummary('内容');
    const second = await service.generateChunkSummary('内容');

    expect(first.summary).toBe('摘要');
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('chunk 摘要失败时应降级为首段', async () => {
    const fetchMock: MockFetch = vi.fn().mockRejectedValue(new Error('network'));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const service = new SummaryService(baseConfig);

    const content = '第一段内容\n\n第二段内容';
    const result = await service.generateChunkSummary(content, { maxRetries: 1, useCache: false });

    expect(result.fallback).toBe(true);
    expect(result.summary).toBe('第一段内容');
  });

  it('document 摘要失败时应降级为前三段拼接', async () => {
    const fetchMock: MockFetch = vi.fn().mockRejectedValue(new Error('network'));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const service = new SummaryService(baseConfig);

    const result = await service.generateDocumentSummary('file.md', ['a', 'b', 'c', 'd'], {
      maxRetries: 1,
      useCache: false,
    });

    expect(result.fallback).toBe(true);
    expect(result.summary).toBe('a b c');
  });

  it('directory 摘要失败时应回退为统计描述', async () => {
    const fetchMock: MockFetch = vi.fn().mockRejectedValue(new Error('network'));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const service = new SummaryService(baseConfig);

    const result = await service.generateDirectorySummary('/tmp', ['a', 'b'], ['sub'], {
      maxRetries: 1,
      useCache: false,
    });

    expect(result.fallback).toBe(true);
    expect(result.summary).toBe('包含 2 个文件和 1 个子目录');
  });

  it('应按 maxRetries 重试调用', async () => {
    vi.useFakeTimers();

    const fetchMock: MockFetch = vi
      .fn()
      .mockResolvedValueOnce(createErrorResponse(500))
      .mockResolvedValueOnce(createOkResponse('重试成功'));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const service = new SummaryService(baseConfig);

    const pending = service.generateChunkSummary('内容', { maxRetries: 2, useCache: false });
    await vi.runAllTimersAsync();

    const result = await pending;

    expect(result.summary).toBe('重试成功');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

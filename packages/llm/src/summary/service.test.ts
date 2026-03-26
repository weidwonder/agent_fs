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
    expect(result.summary).toBe('');
  });

  it('document 摘要失败时应降级为空', async () => {
    const fetchMock: MockFetch = vi.fn().mockRejectedValue(new Error('network'));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const service = new SummaryService(baseConfig);

    const result = await service.generateDocumentSummary('file.md', ['a', 'b', 'c', 'd'], {
      maxRetries: 1,
      useCache: false,
    });

    expect(result.fallback).toBe(true);
    expect(result.summary).toBe('');
  });

  it('directory 摘要失败时应降级为空', async () => {
    const fetchMock: MockFetch = vi.fn().mockRejectedValue(new Error('network'));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const service = new SummaryService(baseConfig);

    const result = await service.generateDirectorySummary('/tmp', ['a', 'b'], ['sub'], {
      maxRetries: 1,
      useCache: false,
    });

    expect(result.fallback).toBe(true);
    expect(result.summary).toBe('');
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

  it('batch 摘要 JSON 解析失败时应重试并降级为逐 chunk 生成', async () => {
    const service = new SummaryService(baseConfig);
    const call = vi.spyOn(service as any, 'callLLM');
    call.mockResolvedValueOnce('not json');
    call.mockResolvedValueOnce('still wrong');
    call.mockResolvedValueOnce('also wrong');
    call.mockResolvedValueOnce('单条摘要-c1');
    call.mockResolvedValueOnce('单条摘要-c2');

    const result = await service.generateChunkSummariesBatch(
      [
        { id: 'c1', content: 'a' },
        { id: 'c2', content: 'b' },
      ],
      { maxRetries: 2, timeoutMs: 10, tokenBudget: 10 }
    );

    expect(result.map((item) => item.summary)).toEqual(['单条摘要-c1', '单条摘要-c2']);
    expect(call).toHaveBeenCalledTimes(5);
    const callOptions = (call.mock.calls as unknown[][]).map(
      (callArgs) => callArgs[1] as { maxRetries: number; timeoutMs?: number }
    );
    expect(callOptions.slice(0, 3)).toEqual([
      { maxRetries: 1, timeoutMs: 10 },
      { maxRetries: 1, timeoutMs: 10 },
      { maxRetries: 1, timeoutMs: 10 },
    ]);
    expect(callOptions.slice(3)).toEqual([
      { maxRetries: 2, timeoutMs: 10 },
      { maxRetries: 2, timeoutMs: 10 },
    ]);
  });

  it('batch 与逐 chunk 都失败时应降级为空', async () => {
    const service = new SummaryService(baseConfig);
    const call = vi.spyOn(service as any, 'callLLM');
    call.mockRejectedValue(new Error('network'));

    const result = await service.generateChunkSummariesBatch(
      [
        { id: 'c1', content: 'a' },
        { id: 'c2', content: 'b' },
      ],
      { maxRetries: 2, timeoutMs: 10, tokenBudget: 10 }
    );

    expect(result.map((item) => item.summary)).toEqual(['', '']);
    expect(result.every((item) => item.fallback)).toBe(true);
    expect(call).toHaveBeenCalledTimes(5);
  });

  it('batch 摘要应按 parallelRequests 并行处理多个批次', async () => {
    const service = new SummaryService(baseConfig);
    let running = 0;
    let maxRunning = 0;

    const call = vi.spyOn(service as any, 'callLLM');
    call.mockImplementation(async (...args: unknown[]) => {
      const messages = (args[0] as Array<{ content: string }>) ?? [];
      const firstMessage = messages[0]?.content ?? '';
      const ids = Array.from(firstMessage.matchAll(/"id":"([^"]+)"/gu)).map(
        (match) => match[1]
      );

      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;

      return JSON.stringify(ids.map((id) => ({ id, summary: `摘要-${id}` })));
    });

    const result = await service.generateChunkSummariesBatch(
      [
        { id: 'c1', content: '第一段内容' },
        { id: 'c2', content: '第二段内容' },
        { id: 'c3', content: '第三段内容' },
      ],
      { tokenBudget: 1, maxRetries: 0, parallelRequests: 2 }
    );

    expect(call).toHaveBeenCalledTimes(3);
    expect(maxRunning).toBeGreaterThan(1);
    expect(result.map((item) => item.summary)).toEqual(['摘要-c1', '摘要-c2', '摘要-c3']);
  });

  it('batch 摘要单次请求最多应包含 4 个 chunk', async () => {
    const service = new SummaryService(baseConfig);
    const batchSizes: number[] = [];

    const call = vi.spyOn(service as any, 'callLLM');
    call.mockImplementation(async (...args: unknown[]) => {
      const messages = (args[0] as Array<{ content: string }>) ?? [];
      const firstMessage = messages[0]?.content ?? '';
      const ids = Array.from(firstMessage.matchAll(/"id":"([^"]+)"/gu)).map(
        (match) => match[1]
      );
      batchSizes.push(ids.length);
      return JSON.stringify(ids.map((id) => ({ id, summary: `摘要-${id}` })));
    });

    const inputs = Array.from({ length: 9 }, (_, index) => ({
      id: `c${index + 1}`,
      content: `第${index + 1}段内容`,
    }));
    const result = await service.generateChunkSummariesBatch(inputs, {
      tokenBudget: 100000,
      maxRetries: 0,
      parallelRequests: 1,
    });

    expect(call).toHaveBeenCalledTimes(3);
    expect(batchSizes).toEqual([4, 4, 1]);
    expect(result.every((item) => item.summary.startsWith('摘要-'))).toBe(true);
  });
});

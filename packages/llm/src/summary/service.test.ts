import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LLMConfig } from '@agent-fs/core';
import { SummaryCache } from './cache';
import {
  SummaryService,
  buildDocumentSummaryInput,
  extractMarkdownHeadings,
  resetSummaryRequestLimiterForTest,
} from './service';

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
  text: async () => '',
  headers: {
    get: () => null,
  },
  json: async () => ({ message: 'error' }),
});

const createRateLimitResponse = (retryAfter = '0.01') => ({
  ok: false,
  status: 429,
  text: async () => '{"error":{"code":"1302","message":"您的账户已达到速率限制"}}',
  headers: {
    get: (name: string) => (name.toLowerCase() === 'retry-after' ? retryAfter : null),
  },
  json: async () => ({ error: { code: '1302' } }),
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetSummaryRequestLimiterForTest();
});

describe('SummaryCache', () => {
  it('应能根据内容与类型缓存摘要', () => {
    const cache = new SummaryCache('test-model', 10);

    expect(cache.get('内容', 'document')).toBeUndefined();

    cache.set('内容', 'document', '摘要A');

    expect(cache.get('内容', 'document')).toBe('摘要A');
    expect(cache.get('内容', 'directory')).toBeUndefined();
  });

  it('clear 应清空缓存', () => {
    const cache = new SummaryCache('test-model', 10);
    cache.set('内容', 'document', '摘要A');

    cache.clear();

    expect(cache.get('内容', 'document')).toBeUndefined();
  });
});

describe('SummaryService', () => {
  it('document 摘要失败时应降级为空', async () => {
    const fetchMock: MockFetch = vi.fn().mockRejectedValue(new Error('network'));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const service = new SummaryService(baseConfig);

    const result = await service.generateDocumentSummary('file.md', '# 标题\n\n正文', {
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

    const pending = service.generateDocumentSummary('demo.md', '# 标题\n\n正文', {
      maxRetries: 2,
      useCache: false,
    });
    await vi.runAllTimersAsync();

    const result = await pending;

    expect(result.summary).toBe('重试成功');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('遇到 429 时应按 retry-after 退避后重试', async () => {
    vi.useFakeTimers();

    const fetchMock: MockFetch = vi
      .fn()
      .mockResolvedValueOnce(createRateLimitResponse('0.01'))
      .mockResolvedValueOnce(createOkResponse('限流后成功'));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const service = new SummaryService(baseConfig);

    const pending = service.generateDocumentSummary('demo.md', '# 标题\n\n限流内容', {
      maxRetries: 2,
      useCache: false,
    });
    await vi.runAllTimersAsync();

    const result = await pending;

    expect(result.summary).toBe('限流后成功');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('应按运行时全局并发上限串行化请求', async () => {
    vi.useFakeTimers();

    let running = 0;
    let maxRunning = 0;
    const fetchMock: MockFetch = vi.fn(async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running -= 1;
      return createOkResponse('受限流保护的摘要');
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const service = new SummaryService(baseConfig, {
      maxConcurrentRequests: 1,
      minRequestIntervalMs: 0,
    });

    const pending = Promise.all([
      service.generateDocumentSummary('a.md', '# A\n\n内容-1', { useCache: false }),
      service.generateDocumentSummary('b.md', '# B\n\n内容-2', { useCache: false }),
      service.generateDocumentSummary('c.md', '# C\n\n内容-3', { useCache: false }),
    ]);

    await vi.runAllTimersAsync();
    await pending;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(maxRunning).toBe(1);
  });

  it('document 摘要应直接使用 markdown 输入', async () => {
    const fetchMock: MockFetch = vi.fn().mockResolvedValue(createOkResponse('文档摘要'));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const service = new SummaryService(baseConfig);
    const markdown = '# 标题\n\n正文';

    const result = await service.generateDocumentSummary('demo.md', markdown);

    expect(result.summary).toBe('文档摘要');
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    const messages = requestBody.messages as Array<{ role: string; content: string }>;
    expect(messages[1]?.content).toContain('文档内容：');
    expect(messages[1]?.content).toContain(markdown);
  });
});

describe('document summary helpers', () => {
  it('应提取 markdown 标题', () => {
    expect(extractMarkdownHeadings('# 一级\n\n## 二级\n\n正文')).toEqual(['一级', '二级']);
  });

  it('长文档输入应回退为前 1000 token 正文加全部标题', () => {
    const longText = '内容'.repeat(20000);
    const markdown = `# 第一章\n\n${longText}\n\n## 第二章\n\n结尾`;
    const input = buildDocumentSummaryInput(markdown);

    expect(input).toContain('文档开头正文（前 1000 token）');
    expect(input).toContain('文档章节结构');
    expect(input).toContain('第一章');
    expect(input).toContain('第二章');
    expect(input).not.toBe(markdown);
  });
});

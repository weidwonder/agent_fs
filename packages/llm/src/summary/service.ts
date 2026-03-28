import type { LLMConfig } from '@agent-fs/core';
import { countTokens } from '@agent-fs/core';
import { SummaryCache } from './cache';
import {
  BATCH_CHUNK_SUMMARY_PROMPT,
  CHUNK_SUMMARY_PROMPT,
  DOCUMENT_SUMMARY_PROMPT,
  DIRECTORY_SUMMARY_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
} from './prompts';
import { groupByTokenBudget, type TokenItem } from './batch-utils';

type ChatMessage = { role: 'user' | 'system'; content: string };
const MAX_CHUNKS_PER_BATCH_REQUEST = 4;
const DEFAULT_COMPLETION_MAX_TOKENS = 1024;
const DEFAULT_RATE_LIMIT_DELAY_MS = 30000;
const MAX_RATE_LIMIT_DELAY_MS = 120000;
const DEFAULT_REQUEST_MIN_INTERVAL_MS = 1500;

class SummaryApiError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(status: number, message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'SummaryApiError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

class RequestLimiter {
  private activeCount = 0;
  private limit: number;
  private waiters: Array<() => void> = [];
  private minIntervalMs: number;
  private nextStartAt = 0;
  private cooldownUntil = 0;
  private scheduleTail: Promise<void> = Promise.resolve();

  constructor(limit: number, minIntervalMs = 0) {
    this.limit = Math.max(1, Math.floor(limit));
    this.minIntervalMs = Math.max(0, Math.floor(minIntervalMs));
  }

  setLimit(limit: number): void {
    this.limit = Math.max(1, Math.floor(limit));
    this.flush();
  }

  setMinInterval(minIntervalMs: number): void {
    this.minIntervalMs = Math.max(0, Math.floor(minIntervalMs));
  }

  setCooldown(delayMs: number): void {
    const normalizedDelayMs = Math.max(0, Math.floor(delayMs));
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + normalizedDelayMs);
  }

  reset(): void {
    this.activeCount = 0;
    this.waiters = [];
    this.nextStartAt = 0;
    this.cooldownUntil = 0;
    this.scheduleTail = Promise.resolve();
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      await this.schedule();
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.activeCount < this.limit) {
      this.activeCount += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.activeCount += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.flush();
  }

  private async schedule(): Promise<void> {
    let releaseSchedule!: () => void;
    const previousSchedule = this.scheduleTail;
    this.scheduleTail = new Promise<void>((resolve) => {
      releaseSchedule = resolve;
    });

    await previousSchedule;

    const scheduledStartAt = Math.max(Date.now(), this.cooldownUntil, this.nextStartAt);
    this.nextStartAt = scheduledStartAt + this.minIntervalMs;
    releaseSchedule();

    const waitMs = scheduledStartAt - Date.now();
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }

  private flush(): void {
    while (this.activeCount < this.limit && this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.();
    }
  }
}

const globalRequestLimiter = new RequestLimiter(2, DEFAULT_REQUEST_MIN_INTERVAL_MS);

export interface SummaryOptions {
  useCache?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
  tokenBudget?: number;
  parallelRequests?: number;
}

export interface SummaryResult {
  summary: string;
  fromCache: boolean;
  fallback: boolean;
}

export interface BatchChunkInput {
  id: string;
  content: string;
}

export interface BatchSummaryResult extends SummaryResult {
  id: string;
}

interface LLMCallOptions {
  maxRetries: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' };
  timeoutMs?: number;
}

export interface SummaryServiceRuntimeOptions {
  maxConcurrentRequests?: number;
  minRequestIntervalMs?: number;
}

export class SummaryService {
  private config: LLMConfig;
  private cache: SummaryCache;

  constructor(config: LLMConfig, runtimeOptions: SummaryServiceRuntimeOptions = {}) {
    this.config = config;
    this.cache = new SummaryCache(config.model);
    if (runtimeOptions.maxConcurrentRequests) {
      globalRequestLimiter.setLimit(runtimeOptions.maxConcurrentRequests);
    }
    if (runtimeOptions.minRequestIntervalMs !== undefined) {
      globalRequestLimiter.setMinInterval(runtimeOptions.minRequestIntervalMs);
    }
  }

  async generateChunkSummary(
    content: string,
    options: SummaryOptions = {}
  ): Promise<SummaryResult> {
    const { useCache = true, maxRetries = 3, timeoutMs } = options;

    if (useCache) {
      const cached = this.cache.get(content, 'chunk');
      if (cached) {
        return { summary: cached, fromCache: true, fallback: false };
      }
    }

    try {
      const prompt = CHUNK_SUMMARY_PROMPT.replace('{content}', content);
      const summary = await this.callLLM(
        this.buildMessages(prompt),
        { maxRetries, timeoutMs }
      );

      if (useCache) {
        this.cache.set(content, 'chunk', summary);
      }

      return { summary, fromCache: false, fallback: false };
    } catch {
      return { summary: '', fromCache: false, fallback: true };
    }
  }

  async generateChunkSummariesBatch(
    chunks: BatchChunkInput[],
    options: SummaryOptions = {}
  ): Promise<BatchSummaryResult[]> {
    const { useCache = true, timeoutMs } = options;
    const maxRetries = options.maxRetries ?? 2;
    const tokenBudget = options.tokenBudget ?? 10000;
    const parallelRequests = Math.max(1, Math.floor(options.parallelRequests ?? 1));

    const results: BatchSummaryResult[] = chunks.map((chunk) => ({
      id: chunk.id,
      summary: '',
      fromCache: false,
      fallback: false,
    }));

    const pending: TokenItem<{ index: number; content: string }>[] = [];

    chunks.forEach((chunk, index) => {
      if (useCache) {
        const cached = this.cache.get(chunk.content, 'chunk');
        if (cached) {
          results[index] = { id: chunk.id, summary: cached, fromCache: true, fallback: false };
          return;
        }
      }

      pending.push({
        id: chunk.id,
        tokens: countTokens(chunk.content),
        payload: { index, content: chunk.content },
      });
    });

    if (pending.length === 0) {
      return results;
    }

    const batches = this.splitBatchesByMaxItems(
      groupByTokenBudget(pending, tokenBudget),
      MAX_CHUNKS_PER_BATCH_REQUEST
    );
    let nextBatchIndex = 0;
    const workerCount = Math.min(parallelRequests, batches.length);
    const workers = Array.from({ length: workerCount }).map(async () => {
      while (nextBatchIndex < batches.length) {
        const batchIndex = nextBatchIndex;
        nextBatchIndex += 1;
        const batch = batches[batchIndex];
        if (!batch) {
          continue;
        }
        await this.processChunkSummaryBatch(batch, {
          useCache,
          maxRetries,
          timeoutMs,
          results,
        });
      }
    });

    await Promise.all(workers);

    return results;
  }

  private async processChunkSummaryBatch(
    batch: TokenItem<{ index: number; content: string }>[],
    context: {
      useCache: boolean;
      maxRetries: number;
      timeoutMs?: number;
      results: BatchSummaryResult[];
    }
  ): Promise<void> {
    const expectedIds = batch.map((item) => item.id);
    const payloadItems = batch.map((item) => ({ id: item.id, text: item.payload.content }));
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: SUMMARY_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: BATCH_CHUNK_SUMMARY_PROMPT.replace('{items}', JSON.stringify(payloadItems)),
      },
    ];

    let parsed: Map<string, string> | null = null;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= context.maxRetries; attempt++) {
      try {
        const raw = await this.callLLM(messages, {
          maxRetries: 1,
          maxTokens: DEFAULT_COMPLETION_MAX_TOKENS,
          responseFormat: { type: 'json_object' },
          timeoutMs: context.timeoutMs,
        });
        parsed = this.parseBatchResponse(raw, expectedIds);
        if (parsed) {
          break;
        }
        throw new Error('invalid_json');
      } catch (error) {
        lastError = error as Error;
        if (attempt < context.maxRetries && lastError.message === 'invalid_json') {
          messages.push({
            role: 'user',
            content: `上次输出无法解析为 JSON，错误信息：${lastError.message}。请仅输出 JSON 对象，格式为 {"items":[{"id":"...","summary":"..."}]}，不要添加任何额外文字。`,
          });
        }
        if (attempt < context.maxRetries && isRateLimitError(lastError)) {
          await sleep(this.getRetryDelayMs(lastError, attempt));
        }
      }
    }

    if (!parsed) {
      if (lastError && isRateLimitError(lastError)) {
        globalRequestLimiter.setCooldown(this.getRetryDelayMs(lastError, context.maxRetries));
        for (const item of batch) {
          const index = item.payload.index;
          context.results[index] = {
            id: item.id,
            summary: '',
            fromCache: false,
            fallback: true,
          };
        }
        return;
      }

      for (const item of batch) {
        const index = item.payload.index;
        const single = await this.generateChunkSummary(item.payload.content, {
          useCache: context.useCache,
          maxRetries: context.maxRetries,
          timeoutMs: context.timeoutMs,
        });
        context.results[index] = {
          id: item.id,
          summary: single.summary,
          fromCache: single.fromCache,
          fallback: single.fallback,
        };
      }
      return;
    }

    for (const item of batch) {
      const index = item.payload.index;
      const summary = parsed.get(item.id) ?? '';

      if (context.useCache) {
        this.cache.set(item.payload.content, 'chunk', summary);
      }

      context.results[index] = { id: item.id, summary, fromCache: false, fallback: false };
    }
  }

  private splitBatchesByMaxItems<T>(
    batches: TokenItem<T>[][],
    maxItems: number
  ): TokenItem<T>[][] {
    const normalizedMaxItems = Math.max(1, Math.floor(maxItems));
    const result: TokenItem<T>[][] = [];

    for (const batch of batches) {
      if (batch.length <= normalizedMaxItems) {
        result.push(batch);
        continue;
      }

      for (let offset = 0; offset < batch.length; offset += normalizedMaxItems) {
        result.push(batch.slice(offset, offset + normalizedMaxItems));
      }
    }

    return result;
  }

  async generateDocumentSummary(
    filename: string,
    chunkSummaries: string[],
    options: SummaryOptions = {}
  ): Promise<SummaryResult> {
    const content = `${filename}\n${chunkSummaries.join('\n')}`;

    if (options.useCache !== false) {
      const cached = this.cache.get(content, 'document');
      if (cached) {
        return { summary: cached, fromCache: true, fallback: false };
      }
    }

    try {
      const prompt = DOCUMENT_SUMMARY_PROMPT
        .replace('{filename}', filename)
        .replace('{chunk_summaries}', chunkSummaries.join('\n'));

      const summary = await this.callLLM(
        this.buildMessages(prompt),
        { maxRetries: options.maxRetries ?? 3, timeoutMs: options.timeoutMs }
      );

      this.cache.set(content, 'document', summary);
      return { summary, fromCache: false, fallback: false };
    } catch {
      return { summary: '', fromCache: false, fallback: true };
    }
  }

  async generateDirectorySummary(
    path: string,
    fileSummaries: string[],
    subdirSummaries: string[],
    options: SummaryOptions = {}
  ): Promise<SummaryResult> {
    const content = `${path}\n${fileSummaries.join('\n')}\n${subdirSummaries.join('\n')}`;

    if (options.useCache !== false) {
      const cached = this.cache.get(content, 'directory');
      if (cached) {
        return { summary: cached, fromCache: true, fallback: false };
      }
    }

    try {
      const prompt = DIRECTORY_SUMMARY_PROMPT
        .replace('{path}', path)
        .replace('{file_summaries}', fileSummaries.join('\n'))
        .replace('{subdirectory_summaries}', subdirSummaries.join('\n'));

      const summary = await this.callLLM(
        this.buildMessages(prompt),
        { maxRetries: options.maxRetries ?? 3, timeoutMs: options.timeoutMs }
      );

      this.cache.set(content, 'directory', summary);
      return { summary, fromCache: false, fallback: false };
    } catch {
      return { summary: '', fromCache: false, fallback: true };
    }
  }

  private parseBatchResponse(raw: string, expectedIds: string[]): Map<string, string> | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    const items = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : null;

    if (!items) {
      return null;
    }

    const map = new Map<string, string>();
    for (const item of items) {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const id = (item as { id?: unknown }).id;
      const summary = (item as { summary?: unknown }).summary;
      if (typeof id !== 'string' || typeof summary !== 'string') {
        return null;
      }
      map.set(id, summary);
    }

    for (const id of expectedIds) {
      if (!map.has(id)) {
        return null;
      }
    }

    return map;
  }

  private buildMessages(prompt: string): ChatMessage[] {
    return [
      {
        role: 'system',
        content: SUMMARY_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: prompt,
      },
    ];
  }

  private async callLLM(
    messages: ChatMessage[],
    options: LLMCallOptions
  ): Promise<string> {
    let lastError: Error | null = null;
    const attemptCount = Math.max(1, options.maxRetries);

    for (let attempt = 0; attempt < attemptCount; attempt++) {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const controller = options.timeoutMs ? new AbortController() : null;

      if (controller && options.timeoutMs) {
        timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);
      }

      try {
        const response = await globalRequestLimiter.run(async () =>
          fetch(`${this.config.base_url}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.config.api_key}`,
            },
            body: JSON.stringify({
              model: this.config.model,
              messages,
              max_tokens: options.maxTokens ?? DEFAULT_COMPLETION_MAX_TOKENS,
              temperature: 0.3,
              do_sample: false,
              thinking: {
                type: 'disabled',
              },
              ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
            }),
            signal: controller?.signal,
          })
        );

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new SummaryApiError(
            response.status,
            `API error: ${response.status}${detail ? ` - ${detail}` : ''}`,
            parseRetryAfterMs(response.headers.get('retry-after'))
          );
        }

        const data = (await response.json()) as {
          choices: Array<{
            message: {
              content: string;
            };
          }>;
        };
        return data.choices[0].message.content.trim();
      } catch (error) {
        lastError = error as Error;
        if (attempt < attemptCount - 1) {
          const retryDelayMs = this.getRetryDelayMs(lastError, attempt);
          if (isRateLimitError(lastError)) {
            globalRequestLimiter.setCooldown(retryDelayMs);
          }
          await sleep(retryDelayMs);
        }
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }

    throw lastError ?? new Error('Failed to generate summary');
  }

  clearCache(): void {
    this.cache.clear();
  }

  private getRetryDelayMs(error: Error, attempt: number): number {
    if (isRateLimitError(error)) {
      const rateLimitDelay =
        error instanceof SummaryApiError && error.retryAfterMs !== null
          ? error.retryAfterMs
          : DEFAULT_RATE_LIMIT_DELAY_MS * Math.pow(2, attempt);
      return Math.min(MAX_RATE_LIMIT_DELAY_MS, rateLimitDelay);
    }

    return Math.pow(2, attempt) * 1000;
  }
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) {
    return null;
  }

  return Math.max(0, retryAt - Date.now());
}

function isRateLimitError(error: Error): boolean {
  return error instanceof SummaryApiError && error.status === 429;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resetSummaryRequestLimiterForTest(): void {
  globalRequestLimiter.reset();
  globalRequestLimiter.setLimit(2);
  globalRequestLimiter.setMinInterval(DEFAULT_REQUEST_MIN_INTERVAL_MS);
}

export function createSummaryService(
  config: LLMConfig,
  runtimeOptions?: SummaryServiceRuntimeOptions
): SummaryService {
  return new SummaryService(config, runtimeOptions);
}

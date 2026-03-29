import type { LLMConfig } from '@agent-fs/core';
import { countTokens, createTokenizer } from '@agent-fs/core';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import type { Root, Heading } from 'mdast';
import { SummaryCache } from './cache';
import {
  DOCUMENT_SUMMARY_PROMPT,
  DIRECTORY_SUMMARY_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
} from './prompts';

type ChatMessage = { role: 'user' | 'system'; content: string };
const DEFAULT_COMPLETION_MAX_TOKENS = 1024;
const DEFAULT_RATE_LIMIT_DELAY_MS = 30000;
const MAX_RATE_LIMIT_DELAY_MS = 120000;
const DEFAULT_REQUEST_MIN_INTERVAL_MS = 1500;
const DOCUMENT_SUMMARY_MAX_INPUT_TOKENS = 10000;
const DOCUMENT_SUMMARY_PREFIX_TOKENS = 1000;

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

export function extractMarkdownHeadings(markdown: string): string[] {
  if (!markdown.trim()) {
    return [];
  }

  const tree = unified().use(remarkParse).parse(markdown) as Root;
  const headings: string[] = [];

  visit(tree, 'heading', (node: Heading) => {
    const text = node.children
      .map((child) => ('value' in child && typeof child.value === 'string' ? child.value : ''))
      .join('')
      .trim();
    if (text) {
      headings.push(text);
    }
  });

  return headings;
}

function sliceTextByTokens(text: string, maxTokens: number): string {
  const tokenizer = createTokenizer();
  const tokens = tokenizer.encode(text);
  if (tokens.length <= maxTokens) {
    return text;
  }
  return tokenizer.decode(tokens.slice(0, maxTokens)).trim();
}

export function buildDocumentSummaryInput(markdown: string): string {
  if (countTokens(markdown) <= DOCUMENT_SUMMARY_MAX_INPUT_TOKENS) {
    return markdown;
  }

  const prefix = sliceTextByTokens(markdown, DOCUMENT_SUMMARY_PREFIX_TOKENS);
  const headings = extractMarkdownHeadings(markdown);
  const headingLines = headings.length > 0 ? headings.map((item) => `- ${item}`).join('\n') : '- 无标题';

  return `文档开头正文（前 1000 token）:\n${prefix}\n\n文档章节结构:\n${headingLines}`;
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

  async generateDocumentSummary(
    filename: string,
    markdown: string,
    options: SummaryOptions = {}
  ): Promise<SummaryResult> {
    const documentContent = buildDocumentSummaryInput(markdown);
    const content = `${filename}\n${markdown}`;

    if (options.useCache !== false) {
      const cached = this.cache.get(content, 'document');
      if (cached) {
        return { summary: cached, fromCache: true, fallback: false };
      }
    }

    try {
      const prompt = DOCUMENT_SUMMARY_PROMPT
        .replace('{filename}', filename)
        .replace('{document_content}', documentContent);

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

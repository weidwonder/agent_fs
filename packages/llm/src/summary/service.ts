import type { LLMConfig } from '@agent-fs/core';
import { countTokens } from '@agent-fs/core';
import { SummaryCache } from './cache';
import {
  BATCH_CHUNK_SUMMARY_PROMPT,
  CHUNK_SUMMARY_PROMPT,
  DOCUMENT_SUMMARY_PROMPT,
  DIRECTORY_SUMMARY_PROMPT,
} from './prompts';
import { groupByTokenBudget, type TokenItem } from './batch-utils';

type ChatMessage = { role: 'user' | 'system'; content: string };

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

export class SummaryService {
  private config: LLMConfig;
  private cache: SummaryCache;

  constructor(config: LLMConfig) {
    this.config = config;
    this.cache = new SummaryCache(config.model);
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
        [{ role: 'user', content: prompt }],
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

    const batches = groupByTokenBudget(pending, tokenBudget);
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
        role: 'user',
        content: BATCH_CHUNK_SUMMARY_PROMPT.replace('{items}', JSON.stringify(payloadItems)),
      },
    ];

    let parsed: Map<string, string> | null = null;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= context.maxRetries; attempt++) {
      try {
        const raw = await this.callLLM(messages, { maxRetries: 1, timeoutMs: context.timeoutMs });
        parsed = this.parseBatchResponse(raw, expectedIds);
        if (parsed) {
          break;
        }
        throw new Error('invalid_json');
      } catch (error) {
        lastError = error as Error;
        if (attempt < context.maxRetries) {
          messages.push({
            role: 'user',
            content: `上次输出无法解析为 JSON，错误信息：${lastError.message}。请仅输出 JSON 数组，格式为 [{"id":"...","summary":"..."}]，不要添加任何额外文字。`,
          });
        }
      }
    }

    if (!parsed) {
      for (const item of batch) {
        const index = item.payload.index;
        context.results[index] = { id: item.id, summary: '', fromCache: false, fallback: true };
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
        [{ role: 'user', content: prompt }],
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
        [{ role: 'user', content: prompt }],
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

    if (!Array.isArray(parsed)) {
      return null;
    }

    const map = new Map<string, string>();
    for (const item of parsed) {
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

  private async callLLM(
    messages: ChatMessage[],
    options: { maxRetries: number; timeoutMs?: number }
  ): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < options.maxRetries; attempt++) {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const controller = options.timeoutMs ? new AbortController() : null;

      if (controller && options.timeoutMs) {
        timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);
      }

      try {
        const response = await fetch(`${this.config.base_url}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.api_key}`,
          },
          body: JSON.stringify({
            model: this.config.model,
            messages,
            max_tokens: 500,
            temperature: 0.3,
          }),
          signal: controller?.signal,
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
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
        if (attempt < options.maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
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
}

export function createSummaryService(config: LLMConfig): SummaryService {
  return new SummaryService(config);
}

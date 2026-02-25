import type { MinerUClientConfig } from 'mineru-ts';

/**
 * MinerU 转换结果
 */
export interface MinerUResult {
  /** Markdown 内容 */
  markdown: string;
  /** 内容列表（包含页码信息） */
  contentList?: MinerUContentList;
  /** PDF 总页数 */
  totalPages?: number;
}

/**
 * MinerU 内容项（content list）
 */
export interface MinerUContentItem {
  type?: string;
  text?: string;
  list_items?: string[];
  bbox?: [number, number, number, number];
  page_idx?: number;
  [key: string]: unknown;
}

/**
 * MinerU 内容列表类型
 */
export type MinerUContentList = MinerUContentItem[];

/**
 * MinerU 配置选项
 */
export type MinerUOptions = MinerUClientConfig & {
  pageConcurrency?: number;
  pageRetryLimit?: number;
  skipFailedPages?: boolean;
};

interface MinerUClientLike {
  initialize: () => Promise<void>;
  parseFile: (pdfPath: string) => Promise<{
    metadata?: {
      totalPages?: number;
    };
  }>;
  resultToMarkdown: (result: unknown) => string;
  resultToContentList: (result: unknown) => unknown;
  twoStepExtract?: (pageImage: unknown) => Promise<unknown>;
  batchTwoStepExtract?: (pageImages: unknown[]) => Promise<unknown[]>;
}

const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_PAGE_CONCURRENCY = 1;
const DEFAULT_PAGE_RETRY_LIMIT = 2;
const DEFAULT_SKIP_FAILED_PAGES = true;
const PARSE_RETRY_LIMIT = 2;
const RETRYABLE_NETWORK_ERROR_PATTERN =
  /EHOSTDOWN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|network error/iu;

async function ensureGlobalFileAvailable(): Promise<void> {
  const globalRecord = globalThis as Record<string, unknown>;
  if (typeof globalRecord.File !== 'undefined') {
    return;
  }

  const bufferModule = await import('node:buffer');
  if (typeof bufferModule.File !== 'undefined') {
    globalRecord.File = bufferModule.File;
  }
}

/**
 * 调用 MinerU TypeScript 客户端转换 PDF
 */
export async function convertPDFWithMinerU(
  pdfPath: string,
  options: MinerUOptions,
): Promise<MinerUResult> {
  await ensureGlobalFileAvailable();
  const {
    pageConcurrency: pageConcurrencyRaw,
    pageRetryLimit: pageRetryLimitRaw,
    skipFailedPages: skipFailedPagesRaw,
    ...minerUClientOptions
  } = options;
  const { MinerUClient } = await import('mineru-ts');
  const initialConcurrency = normalizeMaxConcurrency(minerUClientOptions.maxConcurrency);
  const initialPageConcurrency = normalizePageConcurrency(pageConcurrencyRaw);
  const pageRetryLimit = normalizePageRetryLimit(pageRetryLimitRaw);
  const skipFailedPages = normalizeSkipFailedPages(skipFailedPagesRaw);

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= PARSE_RETRY_LIMIT; attempt += 1) {
    const reducedConcurrency = Math.max(
      1,
      Math.floor(initialConcurrency / (2 ** attempt))
    );
    const reducedPageConcurrency = Math.max(
      1,
      Math.floor(initialPageConcurrency / (2 ** attempt))
    );
    const client = new MinerUClient({
      ...minerUClientOptions,
      maxConcurrency: reducedConcurrency,
    }) as MinerUClientLike;
    patchPageConcurrency(
      client,
      reducedPageConcurrency,
      pageRetryLimit,
      skipFailedPages,
    );

    try {
      await client.initialize();
      const result = await client.parseFile(pdfPath);
      const markdown = client.resultToMarkdown(result);
      const contentList = client.resultToContentList(result) as MinerUContentList;

      return {
        markdown,
        contentList,
        totalPages: result.metadata?.totalPages,
      };
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error) || attempt >= PARSE_RETRY_LIMIT) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000));
    }
  }

  throw (lastError as Error) ?? new Error('PDF 转换失败: 未知错误');
}

function patchPageConcurrency(
  client: MinerUClientLike,
  pageConcurrency: number,
  pageRetryLimit: number,
  skipFailedPages: boolean,
): void {
  const twoStepExtract = client.twoStepExtract;
  if (typeof twoStepExtract !== 'function') {
    return;
  }

  client.batchTwoStepExtract = async (pageImages: unknown[]) => {
    const results: unknown[] = [];

    for (let index = 0; index < pageImages.length; index += pageConcurrency) {
      const batch = pageImages.slice(index, index + pageConcurrency);
      const batchResults = await Promise.all(
        batch.map(async (pageImage) => {
          try {
            return await runSinglePageExtractionWithRetry(
              client,
              twoStepExtract,
              pageImage,
              pageRetryLimit,
            );
          } catch (error) {
            if (skipFailedPages && shouldRetry(error)) {
              const pageIndex = readPageIndex(pageImage);
              const pageLabel = pageIndex === null ? '未知页' : `第 ${pageIndex + 1} 页`;
              const detail = error instanceof Error ? error.message : String(error);
              console.warn(`⚠️ ${pageLabel} 转换失败，已跳过。原因: ${detail}`);
              return [];
            }
            throw error;
          }
        })
      );
      results.push(...batchResults);
    }

    return results;
  };
}

async function runSinglePageExtractionWithRetry(
  client: MinerUClientLike,
  twoStepExtract: (pageImage: unknown) => Promise<unknown>,
  pageImage: unknown,
  pageRetryLimit: number,
): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= pageRetryLimit; attempt += 1) {
    try {
      return await twoStepExtract.call(client, pageImage);
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error) || attempt >= pageRetryLimit) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000));
    }
  }

  throw (lastError as Error) ?? new Error('页面转换失败: 未知错误');
}

function readPageIndex(pageImage: unknown): number | null {
  const pageRecord = toRecord(pageImage);
  if (!pageRecord) {
    return null;
  }
  const pageIndex = pageRecord.pageIndex;
  if (typeof pageIndex !== 'number' || !Number.isFinite(pageIndex)) {
    return null;
  }
  return Math.floor(pageIndex);
}

function shouldRetry(error: unknown): boolean {
  return isEmptyResponseError(error) || isTransientNetworkError(error);
}

function isEmptyResponseError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /Empty response from VLM server/u.test(error.message);
}

function isTransientNetworkError(error: unknown): boolean {
  const errorRecord = toRecord(error);
  if (!errorRecord) {
    return false;
  }

  if (errorRecord.code === 'VLM_REQUEST_ERROR') {
    const details = toRecord(errorRecord.details);
    if (!details || details.statusCode === undefined || details.statusCode === null) {
      return true;
    }
  }

  if (error instanceof Error && RETRYABLE_NETWORK_ERROR_PATTERN.test(error.message)) {
    return true;
  }

  return false;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeMaxConcurrency(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }
  return DEFAULT_MAX_CONCURRENCY;
}

function normalizePageConcurrency(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }
  return DEFAULT_PAGE_CONCURRENCY;
}

function normalizePageRetryLimit(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return DEFAULT_PAGE_RETRY_LIMIT;
}

function normalizeSkipFailedPages(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  return DEFAULT_SKIP_FAILED_PAGES;
}

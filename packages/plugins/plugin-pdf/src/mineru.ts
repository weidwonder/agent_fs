import type { MinerUClientConfig, ParseResult } from 'mineru-ts';

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
export type MinerUOptions = MinerUClientConfig;

interface MinerUClientLike {
  initialize: () => Promise<void>;
  parseFile: (pdfPath: string) => Promise<ParseResult>;
  resultToMarkdown: (result: ParseResult) => string;
  resultToContentList: (result: ParseResult) => MinerUContentList;
}

const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_PAGE_CONCURRENCY = 2;
const DEFAULT_CROP_IMAGE_FORMAT = 'png';
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
  const { MinerUClient } = await import('mineru-ts');
  const normalizedOptions = normalizeMinerUOptions(options);
  const initialConcurrency = normalizeMaxConcurrency(
    normalizedOptions.maxConcurrency,
  );

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= PARSE_RETRY_LIMIT; attempt += 1) {
    const reducedConcurrency = Math.max(
      1,
      Math.floor(initialConcurrency / (2 ** attempt))
    );
    const client = new MinerUClient({
      ...normalizedOptions,
      maxConcurrency: reducedConcurrency,
    }) as MinerUClientLike;

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

function normalizeMinerUOptions(options: MinerUOptions): MinerUOptions {
  return {
    ...options,
    maxConcurrency: normalizeMaxConcurrency(options.maxConcurrency),
    pageConcurrency: normalizePageConcurrency(options.pageConcurrency),
    cropImageFormat: normalizeCropImageFormat(options.cropImageFormat),
  };
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

function normalizeCropImageFormat(value: unknown): 'jpeg' | 'png' {
  return value === 'jpeg' || value === 'png'
    ? value
    : DEFAULT_CROP_IMAGE_FORMAT;
}

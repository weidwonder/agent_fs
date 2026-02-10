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
export type MinerUOptions = MinerUClientConfig;
const DEFAULT_MAX_CONCURRENCY = 4;
const EMPTY_RESPONSE_PARSE_RETRY_LIMIT = 2;

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
  const initialConcurrency = normalizeMaxConcurrency(options.maxConcurrency);

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= EMPTY_RESPONSE_PARSE_RETRY_LIMIT; attempt += 1) {
    const reducedConcurrency = Math.max(
      1,
      Math.floor(initialConcurrency / (2 ** attempt))
    );
    const client = new MinerUClient({
      ...options,
      maxConcurrency: reducedConcurrency,
    });
    await client.initialize();

    try {
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
      if (!isEmptyResponseError(error) || attempt >= EMPTY_RESPONSE_PARSE_RETRY_LIMIT) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000));
    }
  }

  throw (lastError as Error) ?? new Error('PDF 转换失败: 未知错误');
}

function isEmptyResponseError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /Empty response from VLM server/u.test(error.message);
}

function normalizeMaxConcurrency(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }
  return DEFAULT_MAX_CONCURRENCY;
}

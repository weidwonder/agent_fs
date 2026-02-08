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
  const client = new MinerUClient(options);
  await client.initialize();

  const result = await client.parseFile(pdfPath);
  const markdown = client.resultToMarkdown(result);
  const contentList = client.resultToContentList(result) as MinerUContentList;

  return {
    markdown,
    contentList,
    totalPages: result.metadata?.totalPages,
  };
}

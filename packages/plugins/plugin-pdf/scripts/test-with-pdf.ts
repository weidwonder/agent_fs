/**
 * PDF 插件验证脚本
 * 使用方法:
 *   npx tsx scripts/test-with-pdf.ts <pdf-file-path>
 *   MINERU_SERVER_URL=... npx tsx scripts/test-with-pdf.ts <pdf-file-path>
 *   npx tsx scripts/test-with-pdf.ts <pdf-file-path> <server-url>
 */

import { PDFPlugin } from '../src/plugin';
import {
  classifyDocument,
  extractTextPerPage,
  getDefaultMinTextCharsPerPage,
} from '../src/pdf-text-extractor';

function toNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toTuple(value?: string): [number, number] | undefined {
  if (!value) return undefined;
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  return [parts[0], parts[1]];
}

async function main() {
  const pdfPath = process.argv[2];
  const serverUrl = process.env.MINERU_SERVER_URL ?? process.argv[3];
  const minTextCharsPerPage =
    toNumber(process.env.MIN_TEXT_CHARS_PER_PAGE) ??
    getDefaultMinTextCharsPerPage();

  if (!pdfPath) {
    console.error('用法: npx tsx scripts/test-with-pdf.ts <pdf-file-path> [server-url]');
    process.exit(1);
  }

  const outputDir = process.env.MINERU_OUTPUT_DIR;
  const timeout = toNumber(process.env.MINERU_TIMEOUT_MS);
  const maxRetries = toNumber(process.env.MINERU_MAX_RETRIES);
  const maxConcurrency = toNumber(process.env.MINERU_MAX_CONCURRENCY);
  const dpi = toNumber(process.env.MINERU_DPI);
  const layoutImageSize = toTuple(process.env.MINERU_LAYOUT_SIZE);

  console.log('正在验证 PDF 样本:', pdfPath);
  console.log('MinerU 服务地址:', serverUrl ?? '(未提供)');
  console.log('扫描页阈值:', minTextCharsPerPage);
  console.log('---');

  const extractedPages = await extractTextPerPage(pdfPath);
  const classification = classifyDocument(extractedPages, minTextCharsPerPage);
  const route = resolveRoute(classification.type, Boolean(serverUrl));

  console.log('判定类型:', classification.type);
  console.log('最终路径:', route);
  console.log('总页数:', classification.totalPages);
  console.log('文本页数:', classification.textPageCount);
  console.log('扫描页数:', classification.scanPageCount);
  console.log('逐页字符数:');
  for (const page of classification.pages) {
    console.log(
      `  第 ${page.pageNumber} 页 -> ${page.type} (${page.charCount} 字符)`,
    );
  }
  console.log('---');

  const plugin = new PDFPlugin({
    textExtraction: {
      minTextCharsPerPage,
    },
    minerU: serverUrl
      ? {
          serverUrl,
          apiKey: process.env.MINERU_API_KEY,
          modelName: process.env.MINERU_MODEL_NAME,
          outputDir,
          timeout,
          maxRetries,
          maxConcurrency,
          dpi,
          layoutImageSize,
        }
      : undefined,
  });

  await plugin.init();

  try {
    const result = await plugin.toMarkdown(pdfPath);

    console.log('Markdown 摘要（前 500 字符）：');
    console.log(result.markdown.slice(0, 500));
    console.log('...');
    console.log('---');

    console.log('位置映射（前 10 条）：');
    for (const mapping of result.mapping.slice(0, 10)) {
      console.log(
        `  行 ${mapping.markdownRange.startLine}-${mapping.markdownRange.endLine} -> ${mapping.originalLocator}`,
      );
    }

    console.log('---');
    console.log('映射数量:', result.mapping.length);
    console.log('字符数量:', result.markdown.length);
    console.log('行数:', result.markdown.split('\n').length);
  } catch (error) {
    console.error('验证失败:', error);
    process.exit(1);
  } finally {
    await plugin.dispose();
  }
}

function resolveRoute(
  classificationType: 'text' | 'scan' | 'mixed',
  hasMinerU: boolean,
): string {
  if (classificationType === 'text') {
    return 'direct text';
  }
  if (classificationType === 'scan') {
    return hasMinerU ? 'MinerU' : 'MinerU（缺少配置，将报错）';
  }
  return hasMinerU ? 'mixed merge' : 'mixed（无 MinerU，占位输出）';
}

main();

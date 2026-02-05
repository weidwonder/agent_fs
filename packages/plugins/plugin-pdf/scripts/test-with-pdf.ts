/**
 * PDF 插件集成测试脚本
 * 使用方法: MINERU_SERVER_URL=... npx tsx scripts/test-with-pdf.ts <pdf-file-path>
 */

import { PDFPlugin } from '../src/plugin';

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

  if (!pdfPath || !serverUrl) {
    console.error('用法: MINERU_SERVER_URL=... npx tsx scripts/test-with-pdf.ts <pdf-file-path>');
    console.error('或: npx tsx scripts/test-with-pdf.ts <pdf-file-path> <server-url>');
    process.exit(1);
  }

  const outputDir = process.env.MINERU_OUTPUT_DIR;
  const timeout = toNumber(process.env.MINERU_TIMEOUT_MS);
  const maxRetries = toNumber(process.env.MINERU_MAX_RETRIES);
  const maxConcurrency = toNumber(process.env.MINERU_MAX_CONCURRENCY);
  const dpi = toNumber(process.env.MINERU_DPI);
  const layoutImageSize = toTuple(process.env.MINERU_LAYOUT_SIZE);

  console.log('正在测试 PDF 插件:', pdfPath);
  console.log('VLM 服务地址:', serverUrl);
  console.log('---');

  const plugin = new PDFPlugin({
    minerU: {
      serverUrl,
      apiKey: process.env.MINERU_API_KEY,
      modelName: process.env.MINERU_MODEL_NAME,
      outputDir,
      timeout,
      maxRetries,
      maxConcurrency,
      dpi,
      layoutImageSize,
    },
  });

  await plugin.init();

  try {
    const result = await plugin.toMarkdown(pdfPath);

    console.log('Markdown 内容（前 500 字符）：');
    console.log(result.markdown.slice(0, 500));
    console.log('...');
    console.log('---');

    console.log('位置映射:');
    for (const m of result.mapping) {
      console.log(
        `  行 ${m.markdownRange.startLine}-${m.markdownRange.endLine} -> ${m.originalLocator}`,
      );
    }

    console.log('---');
    console.log('映射数量:', result.mapping.length);
    console.log('字符数量:', result.markdown.length);
    console.log('行数:', result.markdown.split('\n').length);
  } catch (error) {
    console.error('错误:', error);
    process.exit(1);
  } finally {
    await plugin.dispose();
  }
}

main();

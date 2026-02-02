/**
 * PDF 插件集成测试脚本
 * 使用方法: npx tsx scripts/test-with-pdf.ts <pdf-file-path>
 */

import { PDFPlugin } from '../src/plugin';

async function main() {
  const pdfPath = process.argv[2];

  if (!pdfPath) {
    console.error('用法: npx tsx scripts/test-with-pdf.ts <pdf-file-path>');
    process.exit(1);
  }

  console.log('正在测试 PDF 插件:', pdfPath);
  console.log('---');

  const plugin = new PDFPlugin({
    minerU: {
      keepTemp: true, // 保留临时文件以供检查
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

#!/usr/bin/env tsx
/**
 * Excel Plugin 集成测试
 * 使用真实的 Excel 文件测试插件功能
 */

import { ExcelPlugin } from './src/plugin';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testExcelPlugin() {
  console.log('🚀 开始 Excel 插件集成测试\n');

  const plugin = new ExcelPlugin();

  try {
    // 1. 初始化插件
    console.log('📦 初始化插件...');
    await plugin.init();
    console.log('✅ 插件初始化成功\n');

    // 2. 测试文件路径
    const testFiles = [
      resolve(__dirname, '../../../test-data/sub_folder2/演示公司(2025).xlsx'),
      resolve(__dirname, '../../../test-data/sub_folder2/货币资金.xlsx'),
    ];

    // 3. 测试每个文件
    for (const filePath of testFiles) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📄 测试文件: ${filePath.split('/').pop()}`);
      console.log('='.repeat(60));

      try {
        const startTime = Date.now();
        const result = await plugin.toMarkdown(filePath);
        const duration = Date.now() - startTime;

        console.log(`\n⏱️  转换耗时: ${duration}ms`);
        console.log(`📊 Markdown 长度: ${result.markdown.length} 字符`);
        console.log(`🗺️  位置映射数量: ${result.mapping.length}`);

        // 显示 Markdown 预览（前 500 字符）
        console.log('\n📝 Markdown 预览:');
        console.log('-'.repeat(60));
        console.log(result.markdown.substring(0, 500));
        if (result.markdown.length > 500) {
          console.log('\n... (省略 ' + (result.markdown.length - 500) + ' 字符)');
        }
        console.log('-'.repeat(60));

        // 显示位置映射
        console.log('\n📍 位置映射:');
        result.mapping.forEach((m, i) => {
          console.log(
            `  ${i + 1}. 行 ${m.markdownRange.startLine}-${m.markdownRange.endLine} => ${m.originalLocator}`
          );
        });

        // 测试定位符解析
        if (result.mapping.length > 0) {
          const firstMapping = result.mapping[0];
          const locatorInfo = plugin.parseLocator(firstMapping.originalLocator);
          console.log('\n🔍 定位符解析测试:');
          console.log(`  原始定位符: ${firstMapping.originalLocator}`);
          console.log(`  显示文本: ${locatorInfo.displayText}`);
          console.log(`  跳转信息: ${JSON.stringify(locatorInfo.jumpInfo)}`);
        }

        console.log('\n✅ 文件转换成功');
      } catch (error) {
        console.error('❌ 文件转换失败:', error);
        throw error;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎉 所有测试通过！');
    console.log('='.repeat(60));
  } finally {
    // 4. 清理
    console.log('\n🧹 清理资源...');
    await plugin.dispose();
    console.log('✅ 清理完成');
  }
}

// 运行测试
testExcelPlugin().catch((error) => {
  console.error('\n💥 测试失败:', error);
  process.exit(1);
});

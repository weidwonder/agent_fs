# @agent-fs/plugin-pdf

PDF 文档处理插件，使用 mineru-ts 将 PDF 转换为 Markdown。

## 功能

- 将 PDF 转换为结构化 Markdown
- 保留 PDF 位置映射（页级粒度）
- 支持双向定位：Markdown <-> PDF
- 复用 Markdown 分块和向量化流程

## 依赖

### MinerU VLM 服务

`mineru-ts` 需要可用的 VLM 服务（serverUrl）。

## 使用

```typescript
import { createPDFPlugin } from '@agent-fs/plugin-pdf';

const plugin = createPDFPlugin({
  minerU: {
    serverUrl: 'http://localhost:30000', // VLM 服务地址
    apiKey: 'sk-...',                    // 可选
    modelName: 'vlm-model',              // 可选
    dpi: 200,                            // 可选
    outputDir: './output',               // 可选：保存图片
    timeout: 600000,                     // 可选
    maxRetries: 3,                       // 可选
    maxConcurrency: 10,                  // 可选
  },
});

await plugin.init();

const result = await plugin.toMarkdown('/path/to/document.pdf');
console.log(result.markdown);
console.log(result.mapping);

await plugin.dispose();
```

## 位置映射格式

### originalLocator

当前版本只支持页级映射：
- `page:N` - 第 N 页

### 示例

```typescript
{
  markdownRange: { startLine: 1, endLine: 50 },
  originalLocator: 'page:1'
}
```

## 测试

```bash
# 单元测试
pnpm --filter @agent-fs/plugin-pdf test

# 集成测试（需要 MinerU VLM 服务）
MINERU_SERVER_URL=http://localhost:30000 npx tsx scripts/test-with-pdf.ts /path/to/sample.pdf
```

## 注意事项

1. **VLM 服务**：需要提前部署并确保 serverUrl 可访问
2. **性能**：PDF 转换较慢（大文件可能需要 1-2 分钟），建议设置 120s 以上超时
3. **位置映射**：当前只支持页级映射，不支持更精确的 bbox 映射
4. **回退机制**：无法从内容列表定位时，会按剩余行数平均分配页范围

## 输出文件

如果设置了 `outputDir`，mineru-ts 会输出提取的图片到 `outputDir/images/`。

## 许可证

MIT

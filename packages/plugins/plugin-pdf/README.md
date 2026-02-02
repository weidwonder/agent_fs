# @agent-fs/plugin-pdf

PDF 文档处理插件，使用 MinerU HTTP API 转换 PDF 为 Markdown。

## 功能

- 将 PDF 转换为结构化 Markdown
- 保留 PDF 位置映射（页级粒度）
- 支持双向定位：Markdown <-> PDF
- 复用 Markdown 分块和向量化流程

## 依赖

### MinerU HTTP 服务

需要部署 [MinerU](https://github.com/opendatalab/MinerU) HTTP 服务。

参考部署方式：
```bash
# 命令行方式（测试用）
mineru -b vlm-http-client -u http://your-api-host:port -p input.pdf -o output/

# 或使用 Docker 部署 HTTP 服务
# 详见 MinerU 文档
```

## 使用

```typescript
import { createPDFPlugin } from '@agent-fs/plugin-pdf';

const plugin = createPDFPlugin({
  minerU: {
    apiHost: 'http://10.144.0.99:30000',  // MinerU HTTP API 地址
    timeout: 120000,                       // 超时时间（毫秒）
    userId: 'user-123',                    // 可选：用户 ID
    apiKey: 'sk-...',                      // 可选：API Key
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
pnpm test

# 集成测试（需要 MinerU HTTP 服务）
npx tsx scripts/test-with-pdf.ts /path/to/sample.pdf
```

## 注意事项

1. **MinerU HTTP 服务**：需要提前部署 MinerU HTTP API 服务
2. **性能**：PDF 转换较慢（大文件可能需要 1-2 分钟），建议设置 120s 以上超时
3. **位置映射**：当前只支持页级映射，不支持更精确的 bbox 映射
4. **回退机制**：如果无法解析 content_list_v2.json，会回退到简单平均分配策略

## 输出文件

MinerU 会生成以下文件（解压后）：
- `xxx.md` - Markdown 文件
- `xxx_content_list_v2.json` - 内容列表（含位置信息）
- `images/` - 提取的图片

## 许可证

MIT

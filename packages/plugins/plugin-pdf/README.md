# @agent-fs/plugin-pdf

PDF 文档处理插件，采用“文本优先 + MinerU 回退”的方案 C：

- **全 text**：直接用 `pdfjs-dist` 本地提取
- **全 scan**：整份 PDF 回退到 MinerU
- **mixed**：文本页保留本地提取，扫描页使用 MinerU，并按页合并

## 功能

- 优先处理原生文本 PDF，避免纯文本文档依赖 VLM
- 基于逐页字符数做扫描判定，默认阈值 `100`
- 判定前会忽略跨页重复页眉/页脚（如网页导出时间戳、URL、页码）
- mixed 文档按页合并直接提取结果与 MinerU 结果
- 输出兼容现有 `DocumentConversionResult`：`markdown + mapping`
- 保留页级定位：`page:N`
- 仅 MinerU 路径受串行锁约束，直接文本提取不串行

## 依赖

### 本地文本提取

使用 `pdfjs-dist` `^4.x`，无需额外服务，适合原生文本 PDF。

### MinerU

扫描件、图片型 PDF，以及 mixed 文档中的扫描页需要 MinerU。若未配置 MinerU：

- 纯文本 PDF：仍可成功
- 纯扫描 PDF：抛出明确错误
- mixed PDF：文本页保留，扫描页写入占位文本 `[扫描页，需配置 MinerU]`

## 使用

```typescript
import { createPDFPlugin } from '@agent-fs/plugin-pdf';

const plugin = createPDFPlugin({
  textExtraction: {
    enabled: true,               // 默认 true
    minTextCharsPerPage: 100,    // <100 字符判为 scan 页
  },
  minerU: {
    serverUrl: 'http://localhost:30000',
    apiKey: 'sk-...',
    modelName: 'vlm-model',
    timeout: 600000,
    maxRetries: 3,
    maxConcurrency: 4,
    cropImageFormat: 'png',
    pageConcurrency: 2,
    pageRetryLimit: 2,
    skipFailedPages: true,
  },
});

await plugin.init();

const result = await plugin.toMarkdown('/path/to/document.pdf');
console.log(result.markdown);
console.log(result.mapping);

await plugin.dispose();
```

## 判定规则

- 单页 `charCount < minTextCharsPerPage` → `scan`
- 跨页重复页眉/页脚不计入 `charCount`
- 所有页都是 `text` → 直接提取
- 所有页都是 `scan` → MinerU
- 同时存在 `text` / `scan` → mixed 按页合并

默认阈值 `100` 可通过 `textExtraction.minTextCharsPerPage` 调整。

## 位置映射

当前版本输出页级 mapping：

- `page:1`
- `page:2`

示例：

```typescript
{
  markdownRange: { startLine: 1, endLine: 20 },
  originalLocator: 'page:1',
}
```

## 测试

```bash
# plugin-pdf 定向测试
pnpm exec vitest run \
  packages/plugins/plugin-pdf/src/pdf-text-extractor.test.ts \
  packages/plugins/plugin-pdf/src/plugin-conversion.test.ts \
  packages/plugins/plugin-pdf/src/plugin-concurrency.test.ts \
  packages/plugins/plugin-pdf/src/plugin.test.ts \
  packages/plugins/plugin-pdf/src/mineru.test.ts

# 构建
pnpm --filter @agent-fs/core build
pnpm --filter @agent-fs/plugin-pdf clean
pnpm --filter @agent-fs/plugin-pdf build

# 真实 PDF 验证（会输出文档分类、最终路径、页级字符数、Markdown 摘要）
pnpm exec tsx packages/plugins/plugin-pdf/scripts/test-with-pdf.ts /path/to/document.pdf

# 若需要同时验证 MinerU 可用性
MINERU_SERVER_URL=http://host:30000 \
pnpm exec tsx packages/plugins/plugin-pdf/scripts/test-with-pdf.ts /path/to/document.pdf
```

## 注意事项

1. 纯文本 PDF 默认不再依赖 MinerU，速度显著更快
2. mixed 文档仍会调用整份 MinerU，但最终按页合并
3. mixed 且无 MinerU 时不会完全失败，但扫描页只会保留占位文本
4. 纯扫描且无 MinerU 时会抛错：`检测到扫描件但未配置 MinerU`
5. MinerU 仍保留网络异常与空响应重试逻辑
6. 未显式配置时，扫描页裁剪图默认走 `PNG`；`pageConcurrency` 仍默认 `2`
7. 若个别重扫描/票据样本在页后段持续丢字，可单独尝试 `pageConcurrency: 1`

## 许可证

MIT

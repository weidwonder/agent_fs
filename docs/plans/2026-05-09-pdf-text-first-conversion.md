---
date: '2026-05-09'
status: 'completed'
designSpec: '../specs/2026-05-09-pdf-text-first-conversion-design.md'
---

# PDF 转换逻辑改写 — 文本优先策略实施计划

> **设计文档：** [docs/specs/2026-05-09-pdf-text-first-conversion-design.md](../specs/2026-05-09-pdf-text-first-conversion-design.md)

## Overview

将 PDF 插件从"100% MinerU"改为"文本优先 + MinerU 回退"。纯文本 PDF 直接用 pdfjs-dist 本地提取（~30x 提速），扫描件/混合文档继续走 MinerU。

**涉及包：** `packages/plugins/plugin-pdf`、`packages/indexer`（配置解析）

**实施结果：** 已完成。当前实现采用方案 C：按页字符数阈值（默认 100，可配置）分类，全 text 直接提取，全 scan 回退 MinerU，mixed 按页合并。

## Step 1: 添加 pdfjs-dist 依赖

**文件：** `packages/plugins/plugin-pdf/package.json`

```bash
cd packages/plugins/plugin-pdf && pnpm add pdfjs-dist
```

验证：`pnpm build` 通过。

- [ ] 完成

## Step 2: 新建 pdf-text-extractor.ts

**文件：** `packages/plugins/plugin-pdf/src/pdf-text-extractor.ts`

职责：PDF 文本提取 + 扫描判定 + 文本转 Markdown + 页级 mapping 构建。

### 2.1 类型定义

```typescript
export interface PageText {
  pageNumber: number;   // 1-based
  text: string;
  charCount: number;
}

export interface PageClassification {
  pageNumber: number;
  type: 'text' | 'scan';
  charCount: number;
  extractedText: string;
}

export interface DocumentClassification {
  type: 'text' | 'scan' | 'mixed';
  pages: PageClassification[];
  totalPages: number;
  textPageCount: number;
  scanPageCount: number;
}

export interface TextExtractionOptions {
  /** 扫描页判定阈值（默认 100） */
  minTextCharsPerPage?: number;
}
```

### 2.2 核心函数

```typescript
/**
 * 逐页提取文本并统计字符数
 */
export async function extractTextPerPage(filePath: string): Promise<PageText[]>

/**
 * 基于字符数阈值分类每页和整文档
 */
export function classifyDocument(
  pages: PageText[],
  minChars?: number,
): DocumentClassification

/**
 * 将文本页列表转为 Markdown + PositionMapping[]
 * 页间用水平线分隔，mapping 精确对应每页行范围
 */
export function directTextToMarkdown(
  pages: PageClassification[],
): { markdown: string; mapping: PositionMapping[] }
```

### 2.3 实现要点

- `pdfjs-dist` 导入路径：`pdfjs-dist/legacy/build/pdf.mjs`（Node.js 兼容）
- `getDocument({ data })` 打开 PDF → 逐页 `getTextContent()` → 拼接 `item.str`
- `classifyDocument` 默认阈值 `MIN_TEXT_CHARS_PER_PAGE = 100`
- `directTextToMarkdown` 中 mapping 构建：逐页累加行数，`startLine` / `endLine` 精确对应
- 页间分隔：`\n\n---\n\n`（水平线），分隔线本身不计入任何页的 mapping 范围

- [ ] 完成

## Step 3: 扩展 PDFPluginOptions 配置

**文件：** `packages/plugins/plugin-pdf/src/plugin.ts`

```typescript
export interface PDFPluginOptions {
  minerU?: MinerUOptions;
  /** 文本提取配置（新增） */
  textExtraction?: TextExtractionOptions & {
    /** 是否启用文本优先（默认 true） */
    enabled?: boolean;
  };
}
```

**默认值：** `textExtraction.enabled = true`，`minTextCharsPerPage = 100`。

- [ ] 完成

## Step 4: 改写 toMarkdown 路由逻辑

**文件：** `packages/plugins/plugin-pdf/src/plugin.ts`

替换现有 `toMarkdown()` 方法为三路路由：

```typescript
async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
  const textExtractionEnabled = this.options.textExtraction?.enabled !== false;

  // 如果禁用文本提取，走原始 MinerU 路径
  if (!textExtractionEnabled) {
    return this.convertViaMinerU(filePath);
  }

  // Step 1: 分类文档
  const pages = await extractTextPerPage(filePath);
  const classification = classifyDocument(
    pages,
    this.options.textExtraction?.minTextCharsPerPage,
  );

  // Step 2: 按分类路由
  switch (classification.type) {
    case 'text':
      return this.convertDirectText(classification);
    case 'scan':
      return this.convertViaMinerU(filePath);
    case 'mixed':
      return this.convertHybrid(filePath, classification);
  }
}
```

### 4.1 convertDirectText

从 `directTextToMarkdown()` 获取 markdown + mapping，经 `insertPageMarkers()` 返回。**不走串行锁，不调 MinerU。**

### 4.2 convertViaMinerU

提取现有 `toMarkdown()` 逻辑为独立方法。增加 MinerU 可用性检查：

```typescript
private async convertViaMinerU(filePath: string): Promise<DocumentConversionResult> {
  const minerUOptions = this.options.minerU;
  if (!minerUOptions?.serverUrl) {
    throw new Error('检测到扫描件但未配置 MinerU，请在插件配置中提供 minerU.serverUrl');
  }
  // ... 现有 MinerU 转换逻辑（不变）
}
```

### 4.3 convertHybrid

混合文档处理：

```typescript
private async convertHybrid(
  filePath: string,
  classification: DocumentClassification,
): Promise<DocumentConversionResult> {
  const minerUOptions = this.options.minerU;

  // 无 MinerU 配置时仅提取文本页
  if (!minerUOptions?.serverUrl) {
    const textPages = classification.pages.filter(p => p.type === 'text');
    // 扫描页填入占位文本
    const allPages = classification.pages.map(p =>
      p.type === 'text' ? p : { ...p, extractedText: '[扫描页，需配置 MinerU]' }
    );
    const result = directTextToMarkdown(allPages);
    return {
      markdown: insertPageMarkers(result.markdown, result.mapping).markdown,
      mapping: insertPageMarkers(result.markdown, result.mapping).mappings,
    };
  }

  // 有 MinerU：并行执行直接提取（已完成）+ MinerU 转换
  const minerUResult = await runWithMinerUConversionLock(() =>
    convertPDFWithMinerU(filePath, minerUOptions),
  );

  // 按页合并：文本页用直接提取，扫描页用 MinerU 输出
  return this.mergeHybridResults(classification, minerUResult);
}
```

### 4.4 mergeHybridResults

```typescript
private mergeHybridResults(
  classification: DocumentClassification,
  minerUResult: MinerUResult,
): DocumentConversionResult {
  // 1. 从 MinerU contentList 按 page_idx 分组
  // 2. 遍历所有页：
  //    - text 页：用 classification.pages[i].extractedText
  //    - scan 页：用 MinerU contentList 该页文本（复用 extractPageTexts 逻辑）
  // 3. 拼接 markdown，构建合并 mapping
  // 4. insertPageMarkers()
}
```

- [ ] 完成

## Step 5: 删除旧代码 + 清理

- 删除 `toMarkdown()` 中的 MinerU 必选检查（`if (!minerUOptions?.serverUrl) throw`）
- `buildPositionMapping` / `extractPageTexts` / `collectText` / `findPageRangeInMarkdown` / `fallbackPageMapping` / `getTotalPages` / `groupContentByPage`：保留在 plugin.ts 内，仅供 MinerU 路径和混合路径使用
- `insertPageMarkers` / `extractPageFromLocator`：保持不变（三条路径共用）

- [ ] 完成

## Step 6: 更新 indexer 配置解析

**文件：** `packages/indexer/src/indexer.ts` — `resolvePdfPluginOptions()`

在现有 `minerU` 解析基础上，增加 `textExtraction` 解析：

```typescript
private resolvePdfPluginOptions(
  raw: Record<string, unknown> | null
): ConstructorParameters<typeof PDFPlugin>[0] {
  const minerURaw = raw ? this.toRecord(raw.minerU) : null;
  const textExtractionRaw = raw ? this.toRecord(raw.textExtraction) : null;

  return {
    minerU: minerURaw ? this.normalizeMinerUOptions(minerURaw) : undefined,
    textExtraction: textExtractionRaw ? {
      enabled: textExtractionRaw.enabled !== false,
      minTextCharsPerPage: typeof textExtractionRaw.minTextCharsPerPage === 'number'
        ? textExtractionRaw.minTextCharsPerPage
        : undefined,
    } : undefined,
  };
}
```

- [ ] 完成

## Step 7: 更新 index.ts 导出

**文件：** `packages/plugins/plugin-pdf/src/index.ts`

新增导出：

```typescript
export type {
  PageText,
  PageClassification,
  DocumentClassification,
  TextExtractionOptions,
} from './pdf-text-extractor';
```

- [ ] 完成

## Step 8: 单元测试 — pdf-text-extractor.test.ts

**文件：** `packages/plugins/plugin-pdf/src/pdf-text-extractor.test.ts`（新增）

### 测试用例

| 组 | 用例 | 验证点 |
|---|---|---|
| extractTextPerPage | mock pdfjs-dist，3 页 PDF | 返回正确的 pageNumber/text/charCount |
| classifyDocument | 全 text (charCount >= 100) | type='text', textPageCount=N |
| classifyDocument | 全 scan (charCount < 100) | type='scan', scanPageCount=N |
| classifyDocument | 混合 | type='mixed', 各计数正确 |
| classifyDocument | 阈值边界 99/100/101 | 99→scan, 100→text, 101→text |
| classifyDocument | 自定义阈值 50 | 按自定义阈值判定 |
| directTextToMarkdown | 3 页文本 | markdown 含水平线分隔，mapping 行范围精确 |
| directTextToMarkdown | 单页 | 无水平线，mapping 覆盖全部行 |
| directTextToMarkdown | 含空页 | 空页文本为空，mapping 仍包含该页 |

### mock 策略

```typescript
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: vi.fn().mockReturnValue({
    promise: Promise.resolve({
      numPages: 3,
      getPage: vi.fn().mockImplementation((pageNum) => Promise.resolve({
        getTextContent: vi.fn().mockResolvedValue({
          items: [{ str: `Page ${pageNum} text content ...` }],
        }),
      })),
    }),
  }),
}));
```

- [ ] 完成

## Step 9: 单元测试 — plugin.test.ts 补充

**文件：** `packages/plugins/plugin-pdf/src/plugin.test.ts`（修改）

### 新增测试用例

| 组 | 用例 | 验证点 |
|---|---|---|
| toMarkdown 路由 | 纯文本 PDF（mock extractTextPerPage） | 不调用 MinerU，直接返回结果 |
| toMarkdown 路由 | 纯扫描 PDF | 调用 MinerU（现有逻辑） |
| toMarkdown 路由 | 混合 PDF + 有 MinerU 配置 | 调用 MinerU + 按页合并 |
| toMarkdown 路由 | 混合 PDF + 无 MinerU 配置 | 文本页正常 + 扫描页占位文本 |
| toMarkdown 路由 | textExtraction.enabled=false | 强制走 MinerU |
| toMarkdown 路由 | 无 MinerU + 纯文本 | 正常工作（不报错） |
| toMarkdown 路由 | 无 MinerU + 纯扫描 | 抛错 |
| mergeHybridResults | 3 页混合（1text+1scan+1text） | markdown 正确合并，mapping 连续 |

- [ ] 完成

## Step 10: 回归测试 + 编译验证

```bash
# 编译
cd packages/plugins/plugin-pdf && pnpm build

# 运行所有 PDF 插件测试
pnpm test --filter @agent-fs/plugin-pdf

# 运行 indexer 测试（验证配置解析不破坏）
pnpm test --filter @agent-fs/indexer
```

- [ ] 所有测试通过
- [ ] 编译无错误

## Step 11: 更新文档

**文件：**
- `packages/plugins/plugin-pdf/README.md` — 更新配置说明（textExtraction 选项）
- `docs/architecture.md` — 更新 PDF 插件架构描述（文本优先策略）

- [ ] 完成

## Success Criteria

- [ ] 纯文本 PDF 不调用 MinerU，直接本地提取
- [ ] 纯扫描 PDF 走 MinerU（行为不变）
- [ ] 混合文档正确合并两种来源
- [ ] 无 MinerU 配置时纯文本 PDF 正常工作
- [ ] 无 MinerU 配置时扫描件报错信息清晰
- [ ] 位置映射（PositionMapping）所有路径均正确
- [ ] insertPageMarkers 所有路径均正常
- [ ] 现有测试全部通过（回归）
- [ ] 新增测试覆盖所有路由分支

## Codex 实现注意事项

### 关键陷阱

1. **pdfjs-dist 导入路径**：Node.js 环境必须用 `pdfjs-dist/legacy/build/pdf.mjs`，不是默认的 `pdfjs-dist`。默认入口依赖浏览器 API 会报错。

2. **pdfjs-dist 类型**：`textContent.items` 的类型是 `TextItem | TextMarkedContent`，需要用类型守卫过滤 `TextMarkedContent`（没有 `str` 属性）：
   ```typescript
   const text = textContent.items
     .filter((item): item is TextItem => 'str' in item)
     .map(item => item.str)
     .join(' ');
   ```

3. **串行锁作用域**：`runWithMinerUConversionLock` 只包裹 MinerU 调用，不要包裹 pdfjs-dist 调用。直接提取是本地计算，无需串行化。

4. **mapping 行号一致性**：`directTextToMarkdown` 生成的 mapping 行号必须是 `insertPageMarkers` 之前的行号。`insertPageMarkers` 会自行调整 offset。

5. **混合合并中 MinerU contentList 可能为空**：`minerUResult.contentList` 是 optional。如果 MinerU 没返回 contentList，扫描页应回退到 MinerU 的整体 markdown 按页均分。

6. **globalThis.File polyfill**：`mineru.ts` 中已有 `ensureGlobalFileAvailable()`，不要在新代码中重复处理。

7. **页间分隔符的行数计算**：`\n\n---\n\n` 展开后是 5 行（空行 + --- + 空行），mapping 中相邻页的行号要跳过这些分隔行。

### 测试重点

1. **阈值边界测试**：99 字符 → scan，100 字符 → text。这是行为分界点。
2. **空 PDF**：0 页 PDF 不应崩溃。
3. **混合合并正确性**：text 页和 scan 页交替出现时，markdown 和 mapping 的连续性。
4. **MinerU 回退**：当 pdfjs-dist 提取异常时（如加密 PDF），应 catch 并回退到 MinerU。
5. **配置透传**：`textExtraction.minTextCharsPerPage` 从 config.yml → indexer → PDFPlugin → classifyDocument 的完整链路。

### 建议依赖版本

```json
{
  "pdfjs-dist": "^4.0.0"
}
```

使用 4.x 分支（稳定版），避免 5.x（仍有 breaking changes）。安装后检查 `node_modules/pdfjs-dist/legacy/build/pdf.mjs` 存在。

### 文件大小控制

- `pdf-text-extractor.ts` 预计 80-120 行（提取 + 分类 + 转 Markdown）
- `plugin.ts` 改写后预计 ~350 行（路由 + 合并 + 现有 MinerU mapping 逻辑）
- 如果 `plugin.ts` 超 400 行，考虑将 MinerU mapping 逻辑（`buildPositionMapping` 等）抽到 `mineru-mapping.ts`

---
date: '2026-05-09'
status: 'ready'
documentRole: 'implementation-plan'
sourceOfTruth: './docs/specs/2026-05-09-pdf-text-first-extraction-design.md'
---

# PDF 转换逻辑改写 — 实施计划

> 设计文档：[docs/specs/2026-05-09-pdf-text-first-extraction-design.md](../specs/2026-05-09-pdf-text-first-extraction-design.md)

## Overview

**目标**: 改写 `@agent-fs/plugin-pdf` 的 `toMarkdown()` 流程，优先使用 `unpdf` 直接提取文本，仅扫描件回退 MinerU。

**优先级**: High  
**预期影响**: 文本 PDF 处理速度提升 ~60-100x，消除对 MinerU 的强依赖

## 关键技术决策

1. **库选型**: `unpdf`（TypeScript-first，per-page text，UnJS 生态）
2. **扫描检测**: 文档级文本密度阈值（默认 50 chars/page）
3. **位置映射**: 基于 per-page text 数组，页边界精确
4. **并发**: 直接提取无锁并行，MinerU 保留串行队列

## 实施步骤

### Step 1: 添加 unpdf 依赖

```bash
cd packages/plugins/plugin-pdf
pnpm add unpdf
```

验证: `pnpm build` 通过

### Step 2: 新建 `text-extractor.ts`

路径: `packages/plugins/plugin-pdf/src/text-extractor.ts`

实现以下导出函数:

```typescript
/** 使用 unpdf 提取 PDF 文本（per-page） */
export async function extractPDFText(filePath: string): Promise<{
  perPageTexts: string[];
  totalPages: number;
}>;

/** 判定是否为扫描件 */
export function isScannedPDF(
  perPageTexts: string[],
  totalPages: number,
  threshold?: number,
): boolean;

/** 将 per-page 文本拼接为 markdown */
export function pagesToMarkdown(perPageTexts: string[]): string;

/** 从 per-page 文本构建 PositionMapping */
export function buildDirectExtractionMapping(
  markdown: string,
  perPageTexts: string[],
): PositionMapping[];
```

**实现要点**:
- `extractPDFText`: 读取文件 buffer → `getDocumentProxy` → `extractText({ mergePages: false })`
- `isScannedPDF`: `totalChars / totalPages < threshold`，默认阈值 50
- `pagesToMarkdown`: 过滤空页，用 `\n\n` 连接
- `buildDirectExtractionMapping`: 遍历非空页，根据行数计算 startLine/endLine，构建 `page:N` locator

### Step 3: 改写 `plugin.ts` 的 `toMarkdown()`

核心逻辑变更:

```typescript
async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
  // 1. 尝试直接提取
  const { perPageTexts, totalPages } = await extractPDFText(filePath);

  // 2. 判定是否扫描件
  if (!isScannedPDF(perPageTexts, totalPages, this.options.scanThreshold)) {
    // 文本 PDF: 直接生成 markdown
    const markdown = pagesToMarkdown(perPageTexts);
    const mapping = buildDirectExtractionMapping(markdown, perPageTexts);
    const withPageMarkers = insertPageMarkers(markdown, mapping);
    return {
      markdown: withPageMarkers.markdown,
      mapping: withPageMarkers.mappings,
    };
  }

  // 3. 扫描件: 走 MinerU
  if (!this.options.minerU?.serverUrl) {
    throw new Error(
      '检测到扫描件 PDF，但未配置 MinerU。请提供 minerU.serverUrl 或确认 PDF 包含可提取文本。'
    );
  }

  // MinerU 路径保持不变（含串行队列）
  const result = await runWithMinerUConversionLock(() =>
    convertPDFWithMinerU(filePath, this.options.minerU!),
  );
  const mapping = this.buildPositionMapping(result);
  const withPageMarkers = insertPageMarkers(result.markdown, mapping);
  return {
    markdown: withPageMarkers.markdown,
    mapping: withPageMarkers.mappings,
  };
}
```

**注意**: 直接提取路径不经过 `runWithMinerUConversionLock`。

### Step 4: 更新 `PDFPluginOptions`

```typescript
export interface PDFPluginOptions {
  minerU?: MinerUOptions;
  /** 扫描件判定阈值（每页平均最少字符数），默认 50 */
  scanThreshold?: number;
}
```

### Step 5: 更新 `index.ts` 导出

新增导出 `text-extractor.ts` 中的类型和函数（仅导出需要外部使用的部分）。

### Step 6: 编写测试

#### `text-extractor.test.ts`（新建）

| 用例 | 预期 |
|------|------|
| `isScannedPDF(['大量文本...'], 1)` | `false` |
| `isScannedPDF([''], 1)` | `true` |
| `isScannedPDF(['少量字符'], 5)` | `true`（平均字符不足） |
| `isScannedPDF([], 0)` | `true` |
| 自定义阈值生效 | 传入 threshold=10 降低灵敏度 |
| `pagesToMarkdown` 过滤空页 | 空页不参与拼接 |
| `pagesToMarkdown` 用 `\n\n` 连接 | 页间有空行分隔 |
| `buildDirectExtractionMapping` 行号计算 | 各页 startLine/endLine 正确 |
| `buildDirectExtractionMapping` 跳过空页 | 空页无 mapping 条目 |

#### `plugin.test.ts`（更新）

| 用例 | 预期 |
|------|------|
| 文本 PDF → 走直接提取路径 | 不调用 MinerU |
| 扫描件 PDF → 走 MinerU 路径 | 调用 convertPDFWithMinerU |
| 扫描件 + MinerU 未配置 → 抛错 | 错误信息含"扫描件" |
| `scanThreshold` 配置生效 | 调整阈值改变路由 |

#### `plugin-concurrency.test.ts`（更新）

| 用例 | 预期 |
|------|------|
| 多个文本 PDF 并发调用 | 不串行，可同时执行 |
| 多个扫描件 PDF 并发调用 | 串行执行（保持现有行为） |

### Step 7: 构建验证

```bash
cd packages/plugins/plugin-pdf
pnpm build
pnpm test
```

### Step 8: 清理

- 移除 `PDFPlugin.toMarkdown()` 中原来对 `minerU.serverUrl` 的前置强校验（现在仅扫描件需要）
- 确认 `init()` 方法无需变更

## 相关代码文件

| 操作 | 文件 |
|------|------|
| 新建 | `packages/plugins/plugin-pdf/src/text-extractor.ts` |
| 新建 | `packages/plugins/plugin-pdf/src/text-extractor.test.ts` |
| 修改 | `packages/plugins/plugin-pdf/src/plugin.ts` |
| 修改 | `packages/plugins/plugin-pdf/src/index.ts` |
| 修改 | `packages/plugins/plugin-pdf/src/plugin.test.ts` |
| 修改 | `packages/plugins/plugin-pdf/src/plugin-concurrency.test.ts` |
| 修改 | `packages/plugins/plugin-pdf/package.json`（添加 unpdf） |
| 不变 | `packages/plugins/plugin-pdf/src/mineru.ts` |
| 不变 | `packages/plugins/plugin-pdf/src/mineru.test.ts` |

## 成功标准

- [ ] `pnpm build` 通过
- [ ] 所有测试通过（新增 + 原有）
- [ ] 文本 PDF 不触发 MinerU 调用
- [ ] 扫描件正确回退 MinerU
- [ ] 文本 PDF 并发不被串行队列阻塞
- [ ] MinerU 未配置时，文本 PDF 仍可正常索引

## 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 阈值误判少量文本 PDF 为扫描件 | 低 | 走 MinerU（性能回退，非功能错误） | 提供 `scanThreshold` 配置项 |
| unpdf 对部分 PDF 提取失败 | 低 | 需 catch 并回退 MinerU | 添加 try-catch 回退 |
| unpdf 提取文本编码异常 | 极低 | 乱码文本进入索引 | 扫描检测阈值会拦截大多数情况 |

## Codex 实施注意事项

1. **unpdf 导入**: `unpdf` 是 ESM-only 包，确保 `import { extractText, getDocumentProxy } from 'unpdf'` 能正确 resolve。项目已是 `"type": "module"`，应无问题
2. **文件读取**: `extractPDFText` 需 `import { readFile } from 'node:fs/promises'` 读取 PDF 为 `Uint8Array`
3. **mock 策略**: 测试中 mock `unpdf` 模块（`vi.mock('unpdf', ...)`），与 `mineru.test.ts` mock `mineru-ts` 的模式一致
4. **不要改 mineru.ts**: MinerU 封装层完全不变
5. **页码从 1 开始**: locator 格式 `page:N` 中 N 从 1 开始，但 unpdf 的 text 数组是 0-indexed
6. **insertPageMarkers 复用**: 直接提取路径和 MinerU 路径都复用已有的 `insertPageMarkers` 函数
7. **错误处理**: `extractPDFText` 失败时应 fallback 到 MinerU（如果可用），而非直接抛错。这提供了额外的韧性
8. **串行队列**: `runWithMinerUConversionLock` 是模块级全局变量，不要移动或重构它，只确保直接提取路径不经过它

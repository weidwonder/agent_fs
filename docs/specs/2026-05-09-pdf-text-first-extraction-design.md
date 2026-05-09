---
date: '2026-05-09'
status: 'draft'
documentRole: 'design-spec'
sourceOfTruth: './docs/requirements.md'
---

# PDF 转换逻辑改写 — 设计规格

> 优先直接提取 PDF 文本；仅扫描件走 MinerU VLM 流程。

## 1. 现状分析

### 当前架构

```
PDF file → MinerU VLM Server → markdown + contentList → PositionMapping → DocumentConversionResult
```

- **唯一路径**: 所有 PDF（含纯文本 PDF）均通过 MinerU VLM 服务器转换
- **依赖**: `mineru-ts@^1.0.3` → 需要外部 MinerU 服务（GPU 推理）
- **并发**: 全局串行队列 `runWithMinerUConversionLock`，同一时刻仅一个 PDF 在转换
- **位置映射**: 从 MinerU `contentList` 的 `page_idx` 构建页级 locator（`page:N`），通过文本匹配确定 markdown 行号范围
- **回退策略**: 无 contentList 时按 ~20 行/页线性分配

### 痛点

| 问题 | 影响 |
|------|------|
| 纯文本 PDF 也走 VLM 推理 | 不必要的 GPU 开销 + 网络延迟 |
| 强依赖外部 MinerU 服务 | 服务不可用 = PDF 完全无法索引 |
| 串行队列瓶颈 | 大批量 PDF 索引速度受限 |
| VLM 文本识别偶有错误 | 对已有嵌入文本的 PDF 反而不如直接提取准确 |

## 2. 方案比较

### 方案 A: unpdf 直接提取 + MinerU 回退（推荐）

```
PDF → unpdf 提取文本 → 判断文本密度 → 文本 PDF? → 直接生成 markdown
                                         ↓ 否
                                    MinerU VLM 转换
```

| 维度 | 评估 |
|------|------|
| 文本提取质量 | unpdf 基于 pdf.js，对嵌入文本 PDF 提取准确 |
| 扫描件处理 | 回退 MinerU，保持现有能力 |
| 新依赖 | `unpdf`（~轻量，UnJS 生态，TypeScript-first） |
| 部署要求 | 文本 PDF 零外部依赖；扫描件仍需 MinerU |
| 并发 | 文本 PDF 无需串行队列，大幅提升吞吐 |
| 位置映射 | unpdf 按页返回文本数组，页边界精确 |
| 风险 | 扫描件判定阈值需调优 |

### 方案 B: pdfjs-dist 直接使用

| 维度 | 评估 |
|------|------|
| 文本提取 | 与 unpdf 底层相同（都用 pdf.js） |
| API 复杂度 | 需手动管理 worker、document proxy、页迭代 |
| 类型支持 | 较弱（@types/pdfjs-dist 不完整） |
| 包体积 | 较大（含 canvas/worker 模块） |
| 结论 | **不推荐** — unpdf 已封装 pdf.js，API 更简洁 |

### 方案 C: pdf-parse

| 维度 | 评估 |
|------|------|
| 文本提取 | 全文拼接，不支持按页分离 |
| 维护状态 | 长期未更新 |
| 页级映射 | 无法实现（无 per-page API） |
| 结论 | **不推荐** — 无法满足页级 locator 需求 |

### 方案 D: 仅 MinerU（维持现状）

| 维度 | 评估 |
|------|------|
| 优点 | 零改动 |
| 缺点 | 保留所有现有痛点 |
| 结论 | **不推荐** |

## 3. 推荐方案详设：unpdf + MinerU 回退

### 3.1 扫描件判定策略

**文档级判定**，基于文本密度阈值：

```typescript
const MIN_CHARS_PER_PAGE = 50;

function isScannedPDF(perPageTexts: string[], totalPages: number): boolean {
  if (totalPages === 0) return true;
  const totalChars = perPageTexts.reduce((sum, t) => sum + t.trim().length, 0);
  const avgCharsPerPage = totalChars / totalPages;
  return avgCharsPerPage < MIN_CHARS_PER_PAGE;
}
```

**设计理由**:
- 50 字符/页阈值：一行中文约 20-40 字，低于此值几乎不可能是正常文本页
- 文档级（非页级）判定：避免混合文档的复杂路由，整文件走同一路径
- 阈值可通过 `PDFPluginOptions` 配置

**边界情况**:
- OCR'd 扫描件（有隐藏文本层）：会被判定为文本 PDF，但这些文本本身可用，直接提取是正确行为
- 封面/目录页文字少：被全文档平均值稀释，不影响判定
- 纯图片 PDF（如相册）：文本量为 0，正确走 MinerU

### 3.2 文本 → Markdown 转换

直接提取的文本是纯文本（无结构标记），转换策略：

```typescript
function pagesToMarkdown(perPageTexts: string[]): string {
  return perPageTexts
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join('\n\n');
}
```

**不做**复杂的 markdown 结构化推断（如标题检测、列表识别）。理由：
1. 纯文本 PDF 的结构信息在 pdf.js 的 text layer 中不可靠
2. MarkdownChunker 已能处理纯文本分块
3. 保持简单，避免引入误判噪声

### 3.3 位置映射

unpdf `extractText({ mergePages: false })` 返回 `string[]`，每个元素对应一页：

```typescript
function buildDirectExtractionMapping(
  markdown: string,
  perPageTexts: string[],
): PositionMapping[] {
  const mappings: PositionMapping[] = [];
  let currentLine = 1;

  for (let i = 0; i < perPageTexts.length; i++) {
    const pageText = perPageTexts[i].trim();
    if (!pageText) continue;

    const pageLines = pageText.split('\n').length;
    // 加上页间空行（两个 \n）
    const endLine = currentLine + pageLines - 1;

    mappings.push({
      markdownRange: { startLine: currentLine, endLine },
      originalLocator: `page:${i + 1}`,
    });

    currentLine = endLine + 2; // +2 for \n\n separator
  }

  return mappings;
}
```

**优势**: 页边界 100% 精确（不依赖文本匹配），比 MinerU 方案更可靠。

### 3.4 并发控制

```
文本 PDF → unpdf 提取 → 无锁，可并行
扫描 PDF → MinerU 转换 → 保留串行队列
```

`runWithMinerUConversionLock` 仅包裹 MinerU 调用，直接提取不受限。

### 3.5 模块结构变更

```
plugin-pdf/src/
├── index.ts              # 导出（新增 text-extractor 导出）
├── plugin.ts             # PDFPlugin 主逻辑（改写 toMarkdown）
├── mineru.ts             # MinerU 客户端封装（不变）
├── text-extractor.ts     # 新增：unpdf 直接提取 + 扫描检测
├── plugin.test.ts        # 更新测试
├── mineru.test.ts        # 不变
├── text-extractor.test.ts # 新增：直接提取测试
└── plugin-concurrency.test.ts # 更新：验证文本 PDF 不走串行队列
```

### 3.6 配置变更

```typescript
export interface PDFPluginOptions {
  minerU?: MinerUOptions;
  /** 扫描件判定阈值（每页最少字符数），默认 50 */
  scanThreshold?: number;
}
```

MinerU 配置变为可选 — 若未配置且检测到扫描件，抛出明确错误。

### 3.7 性能预期

| 场景 | 当前 | 改写后 |
|------|------|--------|
| 10 页文本 PDF | ~10-30s（MinerU 推理） | ~0.1-0.5s（本地提取） |
| 10 页扫描 PDF | ~10-30s（MinerU 推理） | ~10-30s（MinerU 回退） |
| 100 个文本 PDF 批量 | 串行，~15-50min | 可并行，~1-5min |
| MinerU 服务不可用 | 全部失败 | 文本 PDF 正常，仅扫描件失败 |

### 3.8 测试策略

| 测试类型 | 覆盖范围 |
|----------|----------|
| 单元测试 | `isScannedPDF` 阈值判定、`pagesToMarkdown` 文本拼接、`buildDirectExtractionMapping` 行号计算 |
| 单元测试 | `toMarkdown` 路由逻辑（mock unpdf + MinerU，验证分支） |
| 单元测试 | MinerU 未配置 + 扫描件 → 抛出错误 |
| 并发测试 | 文本 PDF 可并行执行（不走串行队列） |
| 集成测试 | 真实文本 PDF 端到端提取（可选，需 fixture） |

## 4. 不采纳的设计

### 4.1 页级混合路由

即同一 PDF 中文本页走直接提取、扫描页走 MinerU。
- **放弃理由**: MinerU 以整文件为单位处理，无法按页拆分调用；混合输出的 markdown 拼接和位置映射复杂度高
- **如果需要**: 未来可通过 MinerU 的 `pageRange` 参数实现，但当前不值得

### 4.2 结构化 Markdown 推断

从直接提取的文本中推断标题/列表/表格。
- **放弃理由**: 无字体大小信息、无布局坐标，推断准确率低；纯文本已可被正确分块和检索

### 4.3 unpdf 替代 mineru-ts

完全移除 MinerU 依赖。
- **放弃理由**: 扫描件无法处理；MinerU 对复杂布局（表格、多栏、公式）的转换质量远高于纯文本提取

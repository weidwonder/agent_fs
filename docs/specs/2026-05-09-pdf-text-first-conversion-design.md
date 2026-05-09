---
date: '2026-05-09'
status: 'approved'
documentRole: 'design-spec'
sourceOfTruth: './docs/requirements.md'
---

# PDF 转换逻辑改写 — 文本优先策略设计文档

> **文档治理说明：** 本文档是 PDF 插件转换逻辑重构的设计规格。与 `docs/requirements.md` 冲突时以 PRD 为准。

## 1. Executive Summary

当前 PDF 插件 100% 依赖 MinerU VLM 服务，即使是纯文本 PDF 也必须经过 VLM 转换。这导致：不必要的服务依赖、高延迟（VLM 推理 vs 本地解析）、资源浪费。

本设计引入 **"文本优先"策略**：优先用 `pdfjs-dist` 直接提取 PDF 文本；仅当检测到扫描件时，回退到 MinerU VLM 流程。采用混合策略（文档级快速判定 + 页级细分）覆盖纯文本、纯扫描、混合文档三种场景。

## 2. 现状分析

### 2.1 当前架构

```
toMarkdown(filePath)
└── convertPDFWithMinerU(filePath)     ← 唯一路径
    ├── MinerUClient.parseFile()       ← VLM 推理（需远程服务）
    ├── resultToMarkdown()
    └── resultToContentList()          ← 用于页级位置映射
```

**问题：**

| 问题 | 影响 |
|------|------|
| MinerU 是唯一路径 | 无服务时 PDF 处理完全不可用 |
| 纯文本 PDF 也走 VLM | 延迟 10-60s vs 本地解析 <1s |
| 进程内串行锁 | 多文件场景下 PDF 成为瓶颈 |
| 服务部署成本 | 需 GPU 服务器运行 VLM |

### 2.2 现有代码结构

| 文件 | 职责 | 行数 |
|------|------|------|
| `plugin.ts` | PDFPlugin 类、位置映射、页标记 | 401 |
| `mineru.ts` | MinerU 客户端封装、重试逻辑 | 150 |
| `index.ts` | 导出 | 9 |

### 2.3 位置映射现状

当前 mapping 构建依赖 MinerU 的 `contentList`（每个 item 含 `page_idx`）。直接文本提取路径需要**独立的**页级映射构建，但实际上更简单——因为 `pdfjs-dist` 天然按页提取，页边界是精确的。

## 3. 可行方案比较

### 方案 A：仅添加文本提取前置层（简单）

在 MinerU 之前加一个文本提取检查：有文本就直接用，没文本再走 MinerU。

| 维度 | 评价 |
|------|------|
| 实现复杂度 | 低 |
| 覆盖场景 | 纯文本 / 纯扫描 |
| 混合文档 | 整文件按多数页类型决定，少数页丢失质量 |
| 位置映射 | 直接提取路径精确；MinerU 路径不变 |
| 风险 | 混合文档处理不理想 |

### 方案 B：逐页独立处理（精细）

每页独立判定并独立处理：文本页直接提取，扫描页单独送 MinerU。

| 维度 | 评价 |
|------|------|
| 实现复杂度 | 高——需要 PDF 拆页或 MinerU 支持页级提交 |
| 覆盖场景 | 所有场景 |
| 混合文档 | 最优质量 |
| 位置映射 | 需合并两种来源的 mapping |
| 风险 | MinerU 不支持单页提交；PDF 拆页引入新依赖 |

### 方案 C：混合策略（推荐）

先整文件快速判定 → 按分类路由 → 混合文档整文件送 MinerU 但按页合并结果。

| 维度 | 评价 |
|------|------|
| 实现复杂度 | 中等 |
| 覆盖场景 | 所有场景 |
| 混合文档 | 文本页用直接提取（更快更准），扫描页用 MinerU 输出 |
| 位置映射 | 两种来源按页合并，页级精度 |
| 风险 | 混合文档仍需完整 MinerU 调用；但这是少数场景 |

**选择方案 C**，理由：覆盖全场景、性能最优（纯文本零 VLM 开销）、实现复杂度可控。

## 4. 推荐方案详细设计

### 4.1 整体架构

```
PDFPlugin.toMarkdown(filePath)
│
├── 1. classifyDocument(filePath)              [NEW: pdf-text-extractor.ts]
│   ├── pdfjs-dist 打开 PDF
│   ├── 逐页提取文本 + 统计字符数
│   ├── 分类每页: 'text' | 'scan'
│   └── 返回 DocumentClassification
│
├── 2a. ALL text → directTextToMarkdown()      [NEW: pdf-text-extractor.ts]
│   ├── 拼接各页文本（页间分隔）
│   ├── 构建精确的页级 PositionMapping[]
│   └── 返回 DocumentConversionResult
│
├── 2b. ALL scan → convertPDFWithMinerU()      [EXISTING: mineru.ts]
│   └── 现有 MinerU 路径（不变）
│
├── 2c. MIXED → hybridConversion()             [NEW: plugin.ts]
│   ├── 并行: 直接文本提取 + MinerU 转换
│   ├── 按页合并: 文本页取直接提取，扫描页取 MinerU
│   ├── 合并 PositionMapping[]
│   └── 返回 DocumentConversionResult
│
└── 3. insertPageMarkers() + return            [EXISTING: plugin.ts]
```

### 4.2 扫描件判定策略

```typescript
interface PageClassification {
  pageNumber: number;        // 1-based
  type: 'text' | 'scan';
  charCount: number;
  extractedText: string;     // 仅 text 页保留
}

interface DocumentClassification {
  type: 'text' | 'scan' | 'mixed';
  pages: PageClassification[];
  totalPages: number;
  textPageCount: number;
  scanPageCount: number;
}
```

**判定规则：**

1. **页级判定：** `charCount < minTextCharsPerPage`（默认 100）→ scan，否则 → text
2. **文档级聚合：**
   - 所有页均为 text → `type: 'text'`
   - 所有页均为 scan → `type: 'scan'`
   - 否则 → `type: 'mixed'`

**阈值 100 字符的依据：** 扫描件页面通常有 0 个可提取字符；纯图片页偶尔有少量 metadata 文本（<20 字符）；100 字符足以区分"有实质文本内容"和"仅有少量噪声"。此阈值可通过配置调整。

### 4.3 直接文本提取

使用 `pdfjs-dist`（Mozilla pdf.js 的 npm 分发包）：

```typescript
// pdf-text-extractor.ts
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

async function extractTextPerPage(filePath: string): Promise<PageText[]> {
  const data = await fs.readFile(filePath);
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: PageText[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    // 过滤 TextMarkedContent（无 str 属性）
    const text = textContent.items
      .filter((item): item is TextItem => 'str' in item)
      .map(item => item.str)
      .join(' ');
    pages.push({ pageNumber: i, text, charCount: text.trim().length });
  }

  return pages;
}
```

**依赖选择理由：**

| 库 | 优点 | 缺点 |
|---|---|---|
| `pdfjs-dist` | 最成熟、每周 3M+ 下载、逐页 API、位置信息 | 包体略大 |
| `unpdf` | 现代 wrapper、轻量 | 底层仍是 pdf.js，多一层抽象 |
| `pdf-parse` | API 最简 | 不支持逐页提取、维护不活跃 |

选择 `pdfjs-dist`：直接使用底层库，无中间抽象，逐页 API 满足扫描判定需求。

### 4.4 文本转 Markdown

直接提取的文本需要基本的 Markdown 格式化：

```typescript
function textToMarkdown(pageTexts: PageText[]): string {
  return pageTexts
    .map(({ text }) => text.trim())
    .filter(Boolean)
    .join('\n\n---\n\n');  // 页间用水平线分隔
}
```

**不做复杂布局分析**（表格检测、标题检测等），理由：
- Agent FS 的目标是搜索索引，不是视觉还原
- 复杂布局分析是 MinerU 的强项，不应在本地重复
- 文本 PDF 的文本本身已经有足够的搜索质量

### 4.5 混合文档处理

混合文档的策略：**全文件送 MinerU + 直接提取，按页合并**。

```
hybridConversion(filePath, classification):
  1. 并行执行:
     - textResult = directTextToMarkdown(classification.pages.filter(text))
     - minerUResult = convertPDFWithMinerU(filePath)
  2. 按页合并:
     for each page:
       if page.type === 'text':
         使用直接提取的文本
       else:
         从 MinerU contentList 提取该页内容
  3. 拼接为完整 markdown
  4. 构建合并的 PositionMapping[]
```

**为什么混合文档仍需完整 MinerU 调用：** MinerU 不支持单页提交，PDF 拆页需要额外依赖（如 pdf-lib）。混合文档是少数场景，完整调用的额外开销可接受。

### 4.6 位置映射影响

| 路径 | 映射来源 | 精度 |
|------|----------|------|
| 直接提取 | pdfjs-dist 逐页 → 精确页边界 | 精确 |
| MinerU | contentList + page_idx（现有逻辑） | 启发式 |
| 混合 | 文本页精确 + 扫描页启发式 | 混合 |

直接提取路径的 mapping 构建**更简单也更精确**：每页的文本行数已知，直接分配 `startLine`/`endLine`。不需要 `findPageRangeInMarkdown()` 启发式搜索。

### 4.7 配置变更

```yaml
# config.yml
plugins:
  pdf:
    # 新增: 文本提取配置
    textExtraction:
      enabled: true                # false 时强制走 MinerU（兼容模式）
      minTextCharsPerPage: 100     # 扫描判定阈值
    # 现有: MinerU 配置（变为可选）
    minerU:
      serverUrl: "http://..."      # 仅扫描/混合文档需要
      maxConcurrency: 4
```

**关键变化：MinerU 配置从必选变为可选。** 如果用户只处理文本 PDF，无需部署 MinerU 服务。仅在遇到扫描件/混合文档时，缺少 MinerU 配置才报错。

### 4.8 错误处理

| 场景 | 行为 |
|------|------|
| 纯文本 PDF + 无 MinerU 配置 | 正常直接提取 |
| 纯扫描 PDF + 无 MinerU 配置 | 抛错："检测到扫描件但未配置 MinerU" |
| 混合 PDF + 无 MinerU 配置 | 仅提取文本页，扫描页标注为 "[扫描页，需配置 MinerU]" |
| pdfjs-dist 提取失败 | 回退到 MinerU（如果可用） |
| 文件损坏 | 抛错（两种路径均失败） |

### 4.9 串行锁调整

现有 `minerUConversionQueue` 串行锁仅约束 MinerU 调用。直接文本提取**不需要串行锁**（pdfjs-dist 是纯本地计算，无远程服务压力）。混合文档中仅 MinerU 调用部分走串行锁。

## 5. 性能影响分析

| 场景 | 当前耗时 | 改写后耗时 | 提升 |
|------|----------|-----------|------|
| 纯文本 PDF (10页) | ~15s (VLM) | ~0.5s (本地) | **30x** |
| 纯文本 PDF (100页) | ~120s (VLM) | ~3s (本地) | **40x** |
| 纯扫描 PDF | ~15-60s (VLM) | ~15-60s (VLM) + ~0.3s (判定) | 持平 |
| 混合文档 | ~15-60s (VLM) | ~15-60s (VLM) + ~0.3s (判定+合并) | 持平 |

**核心收益：** 纯文本 PDF（占多数使用场景）获得数量级性能提升，扫描件场景无退化。

## 6. 依赖影响

| 依赖 | 类型 | 大小 | 说明 |
|------|------|------|------|
| `pdfjs-dist` ^4.x | 新增 runtime | ~30MB (含字体) | 纯 JS，无 native；用 4.x 稳定版 |
| `mineru-ts` | 现有 runtime | 不变 | 变为可选依赖 |

`pdfjs-dist` 体积较大（含标准字体文件），但：
- 无 native 编译，跨平台零问题
- 是 Electron 应用的常见依赖（agent_fs 本身就是 Electron 项目）
- 字体文件可按需加载

## 7. 文件变更计划

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/pdf-text-extractor.ts` | **新增** | 文本提取 + 扫描判定 + 文本转 Markdown |
| `src/plugin.ts` | **修改** | 路由逻辑 + 混合合并 + 配置变更 |
| `src/mineru.ts` | **不变** | MinerU 封装保持原样 |
| `src/index.ts` | **修改** | 导出新类型 |
| `src/pdf-text-extractor.test.ts` | **新增** | 文本提取和扫描判定测试 |
| `src/plugin.test.ts` | **修改** | 新增路由逻辑测试 |
| `package.json` | **修改** | 添加 pdfjs-dist 依赖 |

## 8. 测试策略

### 8.1 单元测试（不依赖外部服务）

| 测试项 | 验证点 |
|--------|--------|
| 文本提取 | pdfjs-dist 提取结果正确性（mock pdfjs-dist） |
| 扫描判定 | 阈值边界：99字符→scan, 100字符→text, 0字符→scan |
| 文档分类 | 纯文本/纯扫描/混合 的正确分类 |
| 直接转换 | 文本→Markdown 格式 + 页分隔 + mapping 精确性 |
| 混合合并 | 两种来源按页合并的正确性 |
| 配置解析 | textExtraction 配置读取 + 默认值 |
| MinerU 可选 | 无 MinerU 配置时纯文本 PDF 正常工作 |

### 8.2 集成测试（需要真实 PDF）

| 测试项 | 测试文件 |
|--------|----------|
| 纯文本 PDF | 准备含纯文本的测试 PDF |
| 纯扫描 PDF | 准备扫描件测试 PDF |
| 混合文档 | 准备文本+图片混合的测试 PDF |
| 大文件 | 100+ 页文本 PDF 性能基准 |

### 8.3 回归测试

- 现有 `plugin.test.ts` 全部通过
- 现有 `mineru.test.ts` 全部通过
- 现有 `plugin-concurrency.test.ts` 全部通过

## 9. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 文本提取质量不如 MinerU | 中 | 中——文本 PDF 的纯文本提取质量通常足够 | 可配置 `textExtraction.enabled: false` 回退 |
| 混合文档判定失误 | 低 | 中——个别页分类错误 | 阈值可调；错误分类不会丢数据，只影响质量 |
| pdfjs-dist 包体大 | 确定 | 低——Electron 项目，30MB 可接受 | 字体按需加载可优化 |
| 加密/受保护 PDF | 低 | 低——pdfjs-dist 支持密码参数 | 提取失败时回退到 MinerU |

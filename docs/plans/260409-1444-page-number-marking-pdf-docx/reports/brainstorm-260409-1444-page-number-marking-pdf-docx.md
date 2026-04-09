---
type: brainstorm
date: 2026-04-09
slug: page-number-marking-pdf-docx
status: agreed
---

# Brainstorm: PDF/Word 解析增加页码标记 + Mapping 升级

## 1. 问题陈述

**起因：** PDF 插件 mapping 已有 `page:N` locator 但 md 正文无页码标记；DOCX 插件 mapping 完全无页码概念，locator 只有 `heading:L:title`/`para:N`/`table:N`。

**真实诉求（用户澄清）：**
1. **UI 跳页**：桌面应用搜索结果需要点击跳转到原文档对应页
2. （PPT 按页拆章节的诉求本次明确**不做**，PPT 插件本期不实现）

**范围：**
- PDF 插件（plugin-pdf）：补 md 正文页码标记
- DOCX 插件（plugin-docx）：补页码（NPOI `LastRenderedPageBreak`）+ md 正文页码标记 + mapping locator 升级
- 搜索回显路径：扩展 `resolveDisplayLocator` 支持 PDF/DOCX
- chunker：**不动**
- PPT 插件：**不做**

## 2. 现状脑图

| 组件 | 当前状态 | 痛点 |
|---|---|---|
| `PositionMapping` 类型 | `{markdownRange, originalLocator: string}` | 无 |
| PDF mapping | 已有 `page:N` + 准确行号区间 | md 正文无标记 |
| DOCX mapping | 已有行号区间，locator 是 `heading:L:title`/`para:N`/`table:N` | 完全无页码 |
| `MarkdownChunker` | 仅按标题切分 | 与本期无关，不动 |
| `resolveDisplayLocator` | 仅对 Excel 生效（`sheet:/range:` 模式） | 需扩展 PDF/DOCX |
| MinerU `contentList` | 含 `page_idx`，可推断页边界 | 已就绪 |
| NPOI `LastRenderedPageBreak` | 可读取 Word 写入的最后渲染分页点 | 第三方生成的 docx 可能没有 |

## 3. 评估过的方案

### 方案 A：md 正文嵌注释 + chunk metadata 双轨（最终选择）
- md 每页首插 `<!-- page: N -->` 一条
- mapping 不改类型，仅改 locator 字符串：
  - PDF 保持 `page:N`
  - DOCX 升级为 `page:N/para:M`、`page:N/heading:L:title`、`page:N/table:M`
- chunker 完全不动，注释作为普通文本行存在
- 搜索层用 chunk `lineStart/lineEnd` 查 mapping 拿页码

**优点：**
- 类型零改动、向后兼容
- md 自带页码方便调试与人工查看
- mapping 路径与现有 Excel 同构（一致性）
- chunker 零侵入，不引入新边界逻辑

**缺点：**
- HTML 注释每页 ~5 token 开销（百页文档约 500 token，可忽略）
- DOCX 页码不保证可得（依赖 Word 保存过的文件）

### 方案 B：扩展 PositionMapping 加 pageStart/pageEnd 字段
- 类型改 `core/src/types/plugin.ts`
- 所有 mapping 消费方都要适配

**否决理由：** 类型扩散面太广（mcp-server / electron-app / locator-display 都要改），违反 YAGNI。locator 字符串方案能用正则抽页码已经够。

### 方案 C：新增独立 PageMapping 数组
- `DocumentConversionResult` 多一个 `pageMapping?: PageMapping[]`
- 与 `PositionMapping` 并存

**否决理由：** 双重维护、概念冗余。YAGNI。

### 方案 D：LibreOffice 双策略获取 DOCX 页码
- 先试 `LastRenderedPageBreak`，失败回退到 soffice 转 PDF 取页码

**否决理由：** 用户明确选 LastRenderedPageBreak，接受"页码可能缺失"的代价。LibreOffice 双策略实现成本高、运行时延迟大。

### 方案 E：md 正文用显式标题 `## 第 N 页`
**否决理由：** 污染原文档标题层级，会破坏 chunker 按标题切分的语义。

## 4. 最终方案（方案 A 详细）

### 4.1 md 正文标记规范

格式：`<!-- page: N -->`
- 每页首插一条，独占一行，前后各空一行
- N 从 1 开始
- 文件第一页的标记可放在 md 文档最开头

示例：
```markdown
<!-- page: 1 -->

# 第一章 引言

云端知识库的核心目标是...

<!-- page: 2 -->

## 1.1 背景

...
```

### 4.2 mapping locator 升级规范

**PDF 插件（plugin-pdf）：**
- locator 保持 `page:N`，不变
- mapping 行号范围保持现有逻辑

**DOCX 插件（plugin-docx）：**
- locator 升级为 `page:N/<原 locator>`，例如：
  - `page:3/para:12`
  - `page:3/heading:2:第二章 引言`
  - `page:3/table:1`
- 当 `LastRenderedPageBreak` 缺失（无法确定页码）时，**降级为旧格式**（`para:12`），保证向后兼容
- 已有的 `parseLocator` 增加对新前缀的解析：识别 `page:N/...` 前缀，剥离后递归解析尾部

### 4.3 PositionMapping 类型

**不动**。`packages/core/src/types/plugin.ts:50` 保持原样。

### 4.4 chunker

**不动**。`packages/core/src/chunker/markdown-chunker.ts` 不感知页码注释。HTML 注释作为普通行落入 chunk 内容，可被 token 计数收纳。

**注意：** chunker 切出的 chunk 内容会自带 `<!-- page: N -->` 注释，**搜索回显时需要剥离**（详见 4.6）。

### 4.5 chunk 携带页码（最小侵入）

`ChunkMetadata`（`packages/core/src/types/chunk.ts`）**可选**新增两个字段：
```ts
interface ChunkMetadata {
  // ...原有字段
  pageStart?: number;
  pageEnd?: number;
}
```

填充时机有两个选项（建议**选 B**）：
- A. chunker 出 chunk 时扫描 chunk 内容里的 `<!-- page: N -->` 注释回填 → chunker 仍要"感知"注释，违背"chunker 不动"
- **B. 索引/搜索阶段在 chunk 写入向量库前，由 indexer 用 chunk 的 lineStart/lineEnd 查 mapping，找出覆盖该范围的 page locator，回填到 chunk metadata** ✅

方案 B 的好处：
- chunker 真的零改动
- 与 Excel 路径完全同构（Excel 也是 indexer 阶段查 mapping）
- 一处改动覆盖 PDF + DOCX

### 4.6 搜索回显路径

`packages/mcp-server/src/tools/locator-display.ts`：
- 当前 `EXCEL_EXTENSIONS` 白名单仅放行 Excel
- 扩展为：PDF (`.pdf`)、DOCX (`.doc`/`.docx`) 也走 mapping 查询
- `selectBestMapping` 逻辑可复用
- 回显字符串例：`第 3 页`（PDF）、`第 3 页 · 第 12 段`（DOCX）

**chunk 内容剥离：** 返回给 Agent 的 chunk 文本需要去掉 `<!-- page: N -->` 注释（一行正则即可），避免污染 LLM 上下文。

### 4.7 DOCX 页码获取实现

**.NET DocxConverter (`Converter.cs`)：**
- NPOI XWPF 遍历 `BodyElements` 时，对每个 `XWPFParagraph` 检查其 runs，是否包含 `LastRenderedPageBreak` 元素
- 维护 `currentPage` 计数器，遇到 `LastRenderedPageBreak` 时 +1
- 在 `MarkdownBuilder.AppendBlock` 调用前，根据当前 page 决定：
  1. 如果与上一段不同页（或首段），先 `AppendPageMarker(currentPage)` 写入 `<!-- page: N -->\n`
  2. 然后 `AppendBlock(markdown, $"page:{currentPage}/{locator}")`

**回退策略：** 若整个文档没有任何 `LastRenderedPageBreak`，**完全不写 page 标记**，locator 也不加 `page:N/` 前缀。前端搜索回显发现 mapping 无页码就显示原 locator。

**对 LibreOffice 文本回退路径（`BuildTextFallback`）：** 不引入页码（无法获取），保持现状。

## 5. 实施考量与风险

### 风险 1：DOCX `LastRenderedPageBreak` 缺失
- **场景：** python-docx/pandoc/golang-docx 等生成的 docx 没有这个元素
- **缓解：** 降级为无页码模式（不破坏现有功能），文档化"建议用户用 Word 打开保存一次以获得页码"
- **不缓解的：** 不引入 LibreOffice 双策略（用户已决策）

### 风险 2：md 注释泄漏到搜索结果文本
- **缓解：** 搜索返回时统一剥离 `<!-- page: \d+ -->` 模式（一行正则）
- **位置：** mcp-server 的 search tool 或 indexer 出 chunk 时

### 风险 3：HTML 注释被某些 markdown 渲染器误解析
- **现实：** 标准 commonmark 兼容，无影响
- **核查：** electron-app 内的 markdown 预览组件（如有）应实测一次

### 风险 4：Mapping locator 字符串格式破坏向后兼容
- **缓解：** PDF 保持 `page:N` 不变；DOCX 在无页码时保持旧格式；`parseLocator` 双格式解析
- **测试：** 需补 unit test 覆盖新旧 locator 双向解析

### 风险 5：chunk 回填页码增加 indexer 计算量
- **量级：** O(chunks × mappings) 但 mapping 数 ≈ 段落数，量级可接受
- **优化：** 若性能敏感可对 mapping 排序后二分查找

## 6. 成功指标与验证

| 指标 | 验证方式 |
|---|---|
| PDF md 正文每页有 `<!-- page: N -->` 标记 | unit test 解析 markdown 计数注释行 = mapping 页数 |
| DOCX 正文页码与原 docx 在 Word 打开看到的页码一致（≥80% 文档） | 手测 5 个真实 docx，比对页码 |
| DOCX 无 `LastRenderedPageBreak` 时不抛错 | unit test 用 python-docx 生成的样本 |
| 搜索结果回显含"第 N 页"字样 | mcp-server 集成测试 |
| 现有 chunker 测试全部通过（chunker 行为零变化） | `pnpm --filter @agent-fs/core test` |
| chunk 内容返回时 `<!-- page: N -->` 已剥离 | search e2e 断言 |
| Excel 回显路径不受影响 | 现有 locator-display 测试通过 |

## 7. 影响文件清单

### 必改
- `packages/plugins/plugin-pdf/src/plugin.ts`
  - `buildPositionMapping` 中按页边界往 markdown 行数组插入注释行
  - 重新计算 mapping 的 startLine/endLine（因插入了注释行）
- `packages/plugins/plugin-docx/dotnet/DocxConverter/Converter.cs`
  - `ConvertDocx` 增加 `LastRenderedPageBreak` 探测
  - `MarkdownBuilder` 增加 `AppendPageMarker` 与 currentPage 管理
  - locator 拼接 `page:N/` 前缀（仅当有页码时）
- `packages/plugins/plugin-docx/src/plugin.ts`
  - `parseLocator` 增加 `page:N/...` 前缀解析
- `packages/mcp-server/src/tools/locator-display.ts`
  - 扩展 `EXCEL_EXTENSIONS` 白名单或重构为多扩展支持
  - 复用 `selectBestMapping` 给 PDF/DOCX
- `packages/mcp-server/src/tools/search.ts`
  - 返回 chunk content 时剥离 `<!-- page: \d+ -->`

### 可能改
- `packages/core/src/types/chunk.ts`
  - 可选加 `pageStart?: number; pageEnd?: number`
- `packages/indexer/...`
  - 索引时为每个 chunk 查 mapping 回填 pageStart/pageEnd

### 测试
- `packages/plugins/plugin-pdf/src/plugin.test.ts`
- `packages/plugins/plugin-docx/src/plugin.test.ts`
- `packages/plugins/plugin-docx/dotnet/DocxConverter.Tests/`
- `packages/mcp-server/src/tools/locator-display.test.ts`
- `packages/mcp-server/src/tools/search.test.ts`

### 不改
- `packages/core/src/types/plugin.ts`（PositionMapping 不动）
- `packages/core/src/chunker/markdown-chunker.ts`（chunker 不动）

## 8. 下一步与依赖

**前置依赖：** 无

**实施顺序建议：**
1. 先做 PDF（mapping 已有页码，最快 PoC）
2. 再做 DOCX .NET 侧（NPOI `LastRenderedPageBreak` 实现 + locator 升级）
3. 再做 mcp-server 回显与 chunk 内容剥离
4. 最后补 indexer 回填（如果决定加 ChunkMetadata 字段）

**遗留待定（需要在写 plan 时确认）：**
- ChunkMetadata 是否真的要加 `pageStart/pageEnd` 字段，还是只在 search 返回结构中临时携带？
- DOCX 完全无页码时，前端 UI 跳页按钮显示什么？是否完全隐藏？
- 是否需要给 docx mapping 引入"近似页码"标志位（避免 UI 误以为精确）？

## 9. 与既有原则的对照

| 原则 | 体现 |
|---|---|
| YAGNI | 不做 PPT、不动 chunker、不扩展 PositionMapping 类型、不引入 LibreOffice |
| KISS | mapping 仅改字符串格式、md 标记一种、chunker 零感知 |
| DRY | 复用 `selectBestMapping`、复用 Excel 同构路径 |
| 旧结构清理 | DOCX 无页码降级为旧 locator 是兼容妥协，但本项目"不要兼容"原则可在确认 LastRenderedPageBreak 覆盖率高后改为"无页码即报错跳过" |

---

**用户决策已锁定：**
- ✅ 真实动机：UI 展示原文跳页定位（PPT 按页拆章节场景延后）
- ✅ DOCX 页码源：`LastRenderedPageBreak`（接受可能缺失）
- ✅ md 标记形式：HTML 注释 `<!-- page: N -->`，每页首一条
- ✅ Mapping 结构：仅改 locator 字符串，类型不动
- ✅ chunker：不动
- ✅ PPT 插件：不做

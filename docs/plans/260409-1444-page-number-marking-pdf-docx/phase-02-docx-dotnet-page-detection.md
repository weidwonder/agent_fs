# Phase 02: DOCX .NET 侧 LastRenderedPageBreak 探测 + locator 升级

## Context Links

- Brainstorm: [`./reports/brainstorm-260409-1444-page-number-marking-pdf-docx.md`](./reports/brainstorm-260409-1444-page-number-marking-pdf-docx.md)
- 主计划: [`plan.md`](./plan.md)
- 相关代码:
  - `packages/plugins/plugin-docx/dotnet/DocxConverter/Converter.cs`
  - `packages/plugins/plugin-docx/dotnet/DocxConverter/Models.cs`
  - `packages/plugins/plugin-docx/dotnet/DocxConverter.Tests/`
- 上游依赖: 无（可与 Phase 1 并行）
- 下游依赖: Phase 3（TS 插件 parseLocator）

## Overview

- **Date:** 2026-04-09
- **Description:** 在 .NET DocxConverter 中探测 NPOI `XWPFRun` 内 `LastRenderedPageBreak`，维护 currentPage 计数器，在 markdown 输出中按页首插入 `<!-- page: N -->`，并将 mapping 的 originalLocator 升级为 `page:N/<原 locator>`；无 `LastRenderedPageBreak` 时降级为旧格式
- **Priority:** P2
- **Implementation Status:** pending
- **Review Status:** pending
- **Effort:** 2h

## Key Insights

- **NPOI API 不确定：** `LastRenderedPageBreak` 不是 NPOI 顶层属性，位于底层 OOXML CT_Br 元素。需访问 `XWPFRun.GetCTR()` 返回的 `CT_R`，再遍历其内部 `Items` 或调用底层 `lastRenderedPageBreakList` 等价物。**实现前必须 spike 验证 API 可用性。**
- 探测思路参考（需 spike 确认）:
  ```csharp
  foreach (var item in run.GetCTR().Items) {
      if (item is CT_Br br && br.type == ST_BrType.page) { ... }
  }
  ```
  `LastRenderedPageBreak` 与普通 `CT_Br` 区别在于 `type` 或独立标签 `lastRenderedPageBreak` — 需在 NPOI 源码或 OOXML 规范确认。
- **跨页段落归属决策（本计划锁定）：** 当 `LastRenderedPageBreak` 出现在段落中间的 run 时，**break 之后的内容算下一页**；整段归属以段落第一个字符所在页为准（即段落首字符页）。理由：段落是 locator 最小粒度，不再细分到 run 级别。
- **回退策略：** 若整文档扫描完没有任何 `LastRenderedPageBreak`，**完全不写页注释，也不加 `page:N/` 前缀**——locator 保持旧格式，与现版本字节级兼容。
- **LibreOffice fallback 路径** (`BuildTextFallback`) **完全不动**，无法获取页码。

## Requirements

**功能：**
- 成功探测 Word 已保存的 docx 中的 `LastRenderedPageBreak`
- md 正文每页首插入 `<!-- page: N -->`
- mapping locator 升级为 `page:N/<旧 locator>`（段落首字符所在页）
- 无 break 时降级为旧格式（locator、markdown 均不加页标记）
- NPOI fallback 路径（无法打开 docx 时走 LibreOffice 文本提取）保持旧行为不变

**非功能：**
- .NET xUnit 测试覆盖：有页码样本、无页码样本、单页样本、跨页段落样本
- `dotnet build` 通过，`dotnet test` 通过
- `docker build` 对应的 dotnet 镜像仍可编译

## Architecture

**Converter.cs 流程：**

```
ConvertDocx(path):
  doc = new XWPFDocument(fileStream)
  
  // 1. Pre-scan: 遍历全文判断是否有任何 LastRenderedPageBreak
  hasPageInfo = DetectHasRenderedPageBreaks(doc)
  
  // 2. Main pass
  currentPage = hasPageInfo ? 1 : 0   // 0 表示禁用页码
  lastEmittedPage = 0
  builder = new MarkdownBuilder()
  
  foreach (element in doc.BodyElements):
    if element is XWPFParagraph para:
      paraStartPage = currentPage
      // 先决定段落开头页（首字符页）：
      // 如果 para 的 runs 中在"首个文本 run 之前"已有 LastRenderedPageBreak，
      // currentPage 已在上一个 element 的 post-scan 阶段递增
      
      if hasPageInfo && paraStartPage != lastEmittedPage:
        builder.AppendPageMarker(paraStartPage)
        lastEmittedPage = paraStartPage
      
      locator = BuildParagraphLocator(para, hasPageInfo ? paraStartPage : null)
      builder.AppendBlock(ParaToMarkdown(para), locator)
      
      // Post-scan: 扫段内所有 run 的 LastRenderedPageBreak 累加 currentPage
      currentPage += CountRenderedPageBreaksInParagraph(para)
    
    else if element is XWPFTable tbl:
      // 表格整体归当前 currentPage
      if hasPageInfo && currentPage != lastEmittedPage: ...
      locator = BuildTableLocator(idx, hasPageInfo ? currentPage : null)
      builder.AppendBlock(TableToMarkdown(tbl), locator)
      // 表格内 runs 也要扫 LastRenderedPageBreak 累加
      currentPage += CountRenderedPageBreaksInTable(tbl)
```

**Locator 构造：**

```csharp
string BuildParagraphLocator(XWPFParagraph para, int? page) {
    var inner = para.StyleID != null && IsHeading(para)
        ? $"heading:{level}:{title}"
        : $"para:{paraIdx}";
    return page.HasValue ? $"page:{page}/{inner}" : inner;
}
```

**MarkdownBuilder 新增：**

```csharp
public void AppendPageMarker(int page) {
    AppendLine("");                    // 前空行（若非文件头）
    AppendLine($"<!-- page: {page} -->");
    AppendLine("");                    // 后空行
}
```

## Related Code Files

**修改：**
- `packages/plugins/plugin-docx/dotnet/DocxConverter/Converter.cs`
  - 新增 `DetectHasRenderedPageBreaks(XWPFDocument)`
  - 新增 `CountRenderedPageBreaksInParagraph(XWPFParagraph)`
  - 新增 `CountRenderedPageBreaksInTable(XWPFTable)`
  - 改 `ConvertDocx` 主循环集成 currentPage 计数
  - 改 locator 构造函数注入 `page:N/` 前缀
- `packages/plugins/plugin-docx/dotnet/DocxConverter/MarkdownBuilder.cs`（如独立文件）
  - 新增 `AppendPageMarker(int page)`
- `packages/plugins/plugin-docx/dotnet/DocxConverter.Tests/*.cs`
  - 新增测试用例

**可能修改：**
- `packages/plugins/plugin-docx/dotnet/DocxConverter/Models.cs`（若需要新字段，目前预期不需要）

**创建：** 无

## Implementation Steps

1. **Spike：验证 NPOI API 可读 `LastRenderedPageBreak`**（0.3h）
   - 写个最小 console 调试代码，加载一个 Word 保存过的 docx
   - 尝试方案 A: `run.GetCTR().Items` 遍历检测 `CT_Br` type=page
   - 尝试方案 B: 检查 NPOI 是否暴露 `run.LastRenderedPageBreak` 或类似属性
   - 尝试方案 C: 反射访问底层 XML `w:lastRenderedPageBreak` 元素
   - **锁定可用路径后再往下写**
2. 在 Converter.cs 顶部添加 helper：`DetectHasRenderedPageBreaks`、`CountRenderedPageBreaksInParagraph`、`CountRenderedPageBreaksInTable`
3. 重构 `ConvertDocx` 主循环，增加 `currentPage`、`lastEmittedPage`、`hasPageInfo` 变量
4. 在段落/表格 append 前，若 `hasPageInfo && currentPage != lastEmittedPage`，调 `AppendPageMarker`
5. 将 locator 构造统一过一个 `WrapLocator(string inner, int? page)` 辅助函数
6. 补 xUnit 测试：
   - `Test_WordSavedDocxHasPageMarkers` — 加载 Word 生成的多页 docx，断言 markdown 含多条 `<!-- page: N -->`，断言至少一条 mapping 的 locator 以 `page:` 开头
   - `Test_PythonDocxFallsBackToLegacyFormat` — 加载 python-docx 生成的 docx，断言 markdown 不含页注释，断言 mapping locator 仍为 `para:N` 格式
   - `Test_SinglePageDocx` — 单页文档应含 1 条 `<!-- page: 1 -->`
   - `Test_CrossPageParagraph` — 跨页段落归属首字符页
7. 运行 `dotnet test` 验证
8. 在 `packages/plugins/plugin-docx` 重新 `pnpm build` 触发 dotnet 子构建
9. （Docker）验证 `docker build` 仍可打包 linux 版 DocxConverter（Dockerfile 已固定 dotnet runtime）

## Todo list

- [ ] Spike 确认 NPOI `LastRenderedPageBreak` 读取 API
- [ ] 实现 `DetectHasRenderedPageBreaks`
- [ ] 实现 `CountRenderedPageBreaksInParagraph` / `CountRenderedPageBreaksInTable`
- [ ] 实现 `MarkdownBuilder.AppendPageMarker`
- [ ] 重构 `ConvertDocx` 主循环集成 currentPage
- [ ] 实现 locator `page:N/` 前缀包装
- [ ] 新增 4 个 xUnit 测试
- [ ] `dotnet build` 通过
- [ ] `dotnet test` 通过
- [ ] `pnpm --filter @agent-fs/plugin-docx build` 通过
- [ ] 手测：对 Word 保存的 5 页 docx 肉眼核对页码

## Success Criteria

- Spike 产出可运行代码片段，证明 `LastRenderedPageBreak` 可读
- `dotnet test` 4 个新用例全绿
- Word 保存的样本 docx 转 md 后，每页首有 1 条 `<!-- page: N -->`
- python-docx 生成的样本 docx 转 md 后无页注释，locator 保持旧格式
- 与原有 chunker / Excel 路径行为完全不受影响

## Risk Assessment

| 风险 | 缓解 |
|---|---|
| NPOI 不直接暴露 `LastRenderedPageBreak` API | Spike 阶段验证 3 条路径（Items 遍历 / 属性 / 底层 XML）；若全失败则升级为 OOXML 直接解析（风险升级项，写 plan 时标注给用户） |
| 跨页段落归属错误 | 锁定为"段落首字符页"，测试用例覆盖 |
| currentPage 计数器顺序错误（段内先 append 后扫 break 可能丢第一页） | Pre-scan 阶段初始化 `currentPage=1`，主循环只在 break 时递增 |
| 表格内 run 的 break 未被扫到 | 显式写 `CountRenderedPageBreaksInTable` 遍历 rows→cells→paragraphs→runs |
| MarkdownBuilder 已有复杂状态（列表、引用嵌套） | `AppendPageMarker` 仅追加 3 行原始文本，不干扰其他状态机 |
| Docker 镜像 build 失败 | Dockerfile 已固定 dotnet 版本，构建流程在近期 commit d046411 已修复 |

## Security Considerations

N/A — 仅解析本地 docx 文件，无外部输入升级。

## Next Steps

- Phase 3：TS 插件 `parseLocator` 要识别 `page:N/` 前缀并剥离后递归解析
- Phase 4：mcp-server 回显要识别 DOCX 扩展名并展示"第 N 页 · 第 M 段"
- Phase 6：端到端验收需准备 Word 保存样本 + python-docx 样本各一份

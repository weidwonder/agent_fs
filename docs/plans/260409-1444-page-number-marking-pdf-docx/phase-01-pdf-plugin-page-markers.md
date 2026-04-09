# Phase 01: PDF 插件 md 注释插入 + mapping 行号重算

## Context Links

- Brainstorm: [`./reports/brainstorm-260409-1444-page-number-marking-pdf-docx.md`](./reports/brainstorm-260409-1444-page-number-marking-pdf-docx.md)
- 主计划: [`plan.md`](./plan.md)
- 相关代码:
  - `packages/plugins/plugin-pdf/src/plugin.ts`
  - `packages/plugins/plugin-pdf/src/plugin.test.ts`
- 上游依赖: 无
- 下游依赖: Phase 4 (搜索回显)、Phase 6 (端到端验收)

## Overview

- **Date:** 2026-04-09
- **Description:** 在 PDF 插件生成的 markdown 正文中按页边界插入 `<!-- page: N -->` 注释行，并同步重算 `PositionMapping.markdownRange.startLine/endLine` 以消除注释插入带来的行号偏移
- **Priority:** P2
- **Implementation Status:** pending
- **Review Status:** pending
- **Effort:** 1h

## Key Insights

- PDF 插件的 MinerU `contentList` 已含 `page_idx`，mapping 中已有 `page:N` locator 与准确行号区间——页信息本就齐备，只需把信息也写进 markdown 正文。
- 插入注释行会让现有 mapping 的行号**全部失真**。必须按单调递增顺序逐行插入，并对每条 mapping 在插入点之后的行号累计 `+offset`。
- 每页首一条，独占一行，前后空行。第一页的注释可直接放在 markdown 最前面。
- **核心算法：** 一次遍历。按 `page_idx` 升序扫描 mapping，在页首第一条 mapping 的 `startLine` 之前插入 `<!-- page: N -->\n\n`，记录累计偏移；后续 mapping 全部 `+= offset`。

## Requirements

**功能：**
- md 正文每页首出现一条 `<!-- page: N -->`（N 从 1 开始）
- mapping 数组行号与重写后的 md 一一对应（任意 mapping 查回 md 内容仍正确）
- 页注释独占一行，前后各一空行
- 现有 `page:N` locator 字符串保持不变

**非功能：**
- 算法 O(lines + mappings)，不扫全文多次
- 单元测试断言：注释行数 == 文档总页数
- 不改动 `DocumentConversionResult` 类型结构

## Architecture

**数据流：**

```
MinerU 输出:
  markdown: string (无页码标记)
  contentList: [{page_idx, ...}, ...]
  
         ↓  buildPositionMapping (现有逻辑)
  
  mapping: PositionMapping[]  // 已含 page:N locator + startLine/endLine
  markdown: string            // 仍无页码标记
  
         ↓  insertPageMarkers (新增)
  
  markdown': string           // 页首嵌 <!-- page: N -->
  mapping': PositionMapping[] // 行号已经 +offset 重算
```

**算法伪代码：**

```
lines = markdown.split('\n')
mappingsSorted = sortByStartLine(mappings)
currentPage = 0
offset = 0           // 已插入的行数
insertions = []      // [{atLine, content}]

for m in mappingsSorted:
  m.startLine += offset
  m.endLine   += offset
  page = extractPageFromLocator(m.originalLocator)  // "page:3" → 3
  if page != currentPage:
    insertAt = m.startLine  // 已调整后的行号
    marker = ['', '<!-- page: ' + page + ' -->', '']
    // 插入 3 行: 空行 + 注释 + 空行 (除非文件头)
    insertions.push({at: insertAt, lines: marker})
    offset += marker.length
    m.startLine += marker.length
    m.endLine   += marker.length
    currentPage = page

// 倒序应用 insertions 到 lines 数组（防止行号冲突）
for ins in reverse(insertions):
  lines.splice(ins.at, 0, ...ins.lines)

return {markdown: lines.join('\n'), mapping: mappingsSorted}
```

**边界情况：**
- 第一条 mapping 的 `startLine=0` 时，marker 省略前导空行
- 同页多个 mapping 只在第一个 mapping 前插一次
- 文档只有一页时仍插一条

## Related Code Files

**修改：**
- `packages/plugins/plugin-pdf/src/plugin.ts` — 新增 `insertPageMarkers` 函数，在 `convert` 返回前调用
- `packages/plugins/plugin-pdf/src/plugin.test.ts` — 新增测试用例

**创建：** 无

**删除：** 无

## Implementation Steps

1. 在 `plugin.ts` 中定位 `convert` 函数里 `buildPositionMapping` 之后、返回 `{markdown, positionMapping}` 之前的位置
2. 新增本地函数 `insertPageMarkers(markdown: string, mappings: PositionMapping[]): { markdown: string; mappings: PositionMapping[] }`
3. 实现上述算法：排序 mapping → 遍历识别页变更点 → 记录 insertions → 累计 offset → 倒序 splice 行数组 → 返回
4. 新增 `extractPageFromLocator(locator: string): number | null`，正则 `^page:(\d+)$` 解析；解析失败返回 null（跳过该 mapping 的页标记逻辑）
5. 在 `convert` 末尾用 `insertPageMarkers` 的结果替换原 markdown 与 mapping
6. 补充单元测试：
   - 构造 3 页样本 PDF 的假 contentList 与 markdown
   - 断言结果 markdown 含 3 条 `<!-- page: N -->`
   - 断言每条 mapping 的 startLine 指向的行内容与原 markdown 对应位置一致
   - 断言单页文档仍有 1 条注释
7. 运行 `pnpm --filter @agent-fs/plugin-pdf test` 验证

## Todo list

- [ ] 阅读 `plugin.ts` 现有 `convert` + `buildPositionMapping` 流程
- [ ] 实现 `extractPageFromLocator`
- [ ] 实现 `insertPageMarkers`
- [ ] 接入 `convert` 返回前的处理链
- [ ] 新增 3 个单测用例（多页 / 单页 / 页首文件头）
- [ ] `pnpm --filter @agent-fs/plugin-pdf test` 通过
- [ ] `pnpm --filter @agent-fs/plugin-pdf build` 通过

## Success Criteria

- 单测断言：注释行数 == contentList 中 unique page_idx 数量
- 单测断言：对每条 mapping，`lines[m.startLine..m.endLine]` 的内容与原 markdown 对应块一致
- `pnpm --filter @agent-fs/plugin-pdf test` 全绿
- 手测样本：用 3–5 页真实 PDF 跑一次，肉眼核对 md 正文页码与 PDF 原文一致

## Risk Assessment

| 风险 | 缓解 |
|---|---|
| mapping 未按 startLine 排序导致 offset 错乱 | 先显式 sort，不依赖输入顺序 |
| 同页多 mapping 重复插注释 | 用 `currentPage` 守卫只在页切换时插入 |
| 某条 mapping 的 locator 不是 `page:N` 格式 | `extractPageFromLocator` 返回 null 时跳过，保底不抛错 |
| 倒序 splice 实现错误 | 使用记录 insertions 倒序 apply 而非直接在循环内 splice |

## Security Considerations

N/A — 仅内存字符串处理，无外部输入信任链变化。

## Next Steps

- Phase 4 将依赖 PDF 插件输出的 markdown 含页注释，并在 search tool 返回前剥离
- Phase 6 端到端验收时会用真实 PDF 样本跑 indexer → search → 回显链路

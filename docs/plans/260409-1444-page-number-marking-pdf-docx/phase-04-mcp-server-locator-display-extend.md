# Phase 04: mcp-server 搜索回显扩展 + chunk 内容剥离

## Context Links

- Brainstorm: [`./reports/brainstorm-260409-1444-page-number-marking-pdf-docx.md`](./reports/brainstorm-260409-1444-page-number-marking-pdf-docx.md)
- 主计划: [`plan.md`](./plan.md)
- 相关代码:
  - `packages/mcp-server/src/tools/locator-display.ts`
  - `packages/mcp-server/src/tools/locator-display.test.ts`
  - `packages/mcp-server/src/tools/search.ts`
  - `packages/mcp-server/src/tools/search.test.ts`
- 上游依赖: Phase 1（PDF md 含页注释）+ Phase 3（DOCX parseLocator 识别 page 前缀）
- 下游依赖: Phase 6（端到端验收）

## Overview

- **Date:** 2026-04-09
- **Description:** 扩展 `resolveDisplayLocator` 白名单支持 PDF/DOCX，复用 `selectBestMapping` 逻辑，生成"第 N 页"/"第 N 页 · 第 M 段"格式回显；同时在 search tool 返回 chunk content 前剥离 `<!-- page: \d+ -->` HTML 注释
- **Priority:** P2
- **Implementation Status:** pending
- **Review Status:** pending
- **Effort:** 1h

## Key Insights

- 现 `locator-display.ts` 的 `EXCEL_EXTENSIONS` 白名单只放行 `.xls`/`.xlsx`，分派逻辑基于扩展名 + `sheet:/range:` locator 模式判定
- 本次重构为 **"扩展名 → locator 模式 → 回显 formatter"** 的三段式 dispatch 表，避免把 if/else 链无限拉长
- 支持的组合：
  - `.xlsx/.xls` + `sheet:N/range:...` → `工作表 N / A1:B3`（现状）
  - `.pdf` + `page:N` → `第 N 页`
  - `.doc/.docx` + `page:N/para:M` → `第 N 页 · 第 M 段`
  - `.doc/.docx` + `page:N/heading:L:title` → `第 N 页 · 标题 "title"`
  - `.doc/.docx` + `page:N/table:M` → `第 N 页 · 表 M`
  - `.doc/.docx` + 无 page 前缀（降级情况）→ 显示旧格式 `第 M 段` / `标题 "title"` / `表 M`
- **chunk 内容剥离：** search tool 在构建返回结果时，对每个 hit 的 `content` 字段 `replace(/^\s*<!-- page: \d+ -->\s*$/gm, '')`。一条正则即可。位置选 search.ts 内部，不动 chunker。

## Requirements

**功能：**
- PDF 搜索结果 hit 的 displayLocator 形如 `第 3 页`
- DOCX 搜索结果 hit 的 displayLocator 形如 `第 3 页 · 第 12 段`
- DOCX 无页码（降级）的 hit 回显不含 `第 N 页` 前缀
- search tool 返回的 chunk content 不含 `<!-- page: N -->` 注释
- Excel 回显路径零行为变化

**非功能：**
- 单元测试覆盖 6 种新组合 + Excel 回归 + chunk 剥离
- search tool 端到端快照测试更新
- 整个 dispatch 表 < 80 行，避免 if/else 拉长

## Architecture

**dispatch 表结构：**

```typescript
type DisplayFormatter = (locator: string, mapping?: PositionMapping) => string | null;

interface DisplayRule {
  extensions: string[];           // 小写，含点
  match: RegExp;                  // 匹配 locator 字符串
  format: (match: RegExpMatchArray) => string;
}

const DISPLAY_RULES: DisplayRule[] = [
  // Excel
  { extensions: ['.xls', '.xlsx'],
    match: /^sheet:(\d+)\/range:(.+)$/,
    format: (m) => `工作表 ${m[1]} / ${m[2]}` },
  // PDF
  { extensions: ['.pdf'],
    match: /^page:(\d+)$/,
    format: (m) => `第 ${m[1]} 页` },
  // DOCX with page prefix
  { extensions: ['.doc', '.docx'],
    match: /^page:(\d+)\/para:(\d+)$/,
    format: (m) => `第 ${m[1]} 页 · 第 ${m[2]} 段` },
  { extensions: ['.doc', '.docx'],
    match: /^page:(\d+)\/heading:\d+:(.+)$/,
    format: (m) => `第 ${m[1]} 页 · 标题 "${m[2]}"` },
  { extensions: ['.doc', '.docx'],
    match: /^page:(\d+)\/table:(\d+)$/,
    format: (m) => `第 ${m[1]} 页 · 表 ${m[2]}` },
  // DOCX fallback (no page)
  { extensions: ['.doc', '.docx'],
    match: /^para:(\d+)$/,
    format: (m) => `第 ${m[1]} 段` },
  { extensions: ['.doc', '.docx'],
    match: /^heading:\d+:(.+)$/,
    format: (m) => `标题 "${m[1]}"` },
  { extensions: ['.doc', '.docx'],
    match: /^table:(\d+)$/,
    format: (m) => `表 ${m[1]}` },
];
```

**resolveDisplayLocator 主流程：**

```
1. ext = extname(path).toLowerCase()
2. bestMapping = selectBestMapping(chunk, mappings)  // 复用现有
3. locator = bestMapping?.originalLocator ?? chunk.originalLocator  // 按 selectBestMapping 语义
4. for rule in DISPLAY_RULES:
     if rule.extensions.includes(ext):
       m = locator.match(rule.match)
       if m: return rule.format(m)
5. return null  // fallback: 不展示
```

**chunk 内容剥离（search.ts）：**

```typescript
const PAGE_MARKER_RE = /^\s*<!-- page: \d+ -->\s*\n?/gm;

function stripPageMarkers(content: string): string {
  return content.replace(PAGE_MARKER_RE, '');
}

// 在构建 hit 对象时调用
hit.content = stripPageMarkers(hit.content);
```

## Related Code Files

**修改：**
- `packages/mcp-server/src/tools/locator-display.ts` — 重构为 dispatch 表
- `packages/mcp-server/src/tools/locator-display.test.ts` — 补新用例
- `packages/mcp-server/src/tools/search.ts` — 加 `stripPageMarkers` 调用
- `packages/mcp-server/src/tools/search.test.ts` — 加剥离断言

**创建：** 无

**删除：** 无

## Implementation Steps

1. 阅读现 `locator-display.ts`，确认 `selectBestMapping`、`EXCEL_EXTENSIONS` 与主入口函数名
2. 把 `EXCEL_EXTENSIONS` 替换为 `DISPLAY_RULES` 表（按上述结构）
3. 把主入口函数改为遍历规则表匹配的形式
4. 确认返回 null 的语义与调用方（应该是 "不显示 displayLocator 字段"）
5. 在 `locator-display.test.ts` 添加测试（≥6 个）：
   - `.pdf` + `page:3` → `第 3 页`
   - `.docx` + `page:3/para:12` → `第 3 页 · 第 12 段`
   - `.docx` + `page:3/heading:2:第二章` → `第 3 页 · 标题 "第二章"`
   - `.docx` + `page:3/table:1` → `第 3 页 · 表 1`
   - `.docx` + `para:12`（降级）→ `第 12 段`
   - `.xlsx` + `sheet:1/range:A1:B3` → `工作表 1 / A1:B3`（回归）
6. 在 `search.ts` 找到构建 hit 返回对象的位置，在 content 赋值前调用 `stripPageMarkers`
7. 在 `search.test.ts` 新增 1 个断言：mock chunk 包含 `<!-- page: 2 -->` 注释，验证返回值不含
8. 运行 `pnpm --filter @agent-fs/mcp-server test`
9. 运行 `pnpm --filter @agent-fs/mcp-server build`

## Todo list

- [ ] 重构 `locator-display.ts` 为 dispatch 表
- [ ] 新增 6 个 locator-display 测试
- [ ] 在 `search.ts` 新增 `stripPageMarkers`
- [ ] 新增 search.ts 剥离断言
- [ ] `pnpm --filter @agent-fs/mcp-server test` 通过
- [ ] `pnpm --filter @agent-fs/mcp-server build` 通过

## Success Criteria

- 所有新增测试全绿
- Excel 原有测试完全通过（回归无退化）
- 手测：对 PDF/DOCX 样本发起 search 调用，返回 displayLocator 字段符合预期
- 手测：返回的 chunk content 不含 `<!-- page: N -->` 注释

## Risk Assessment

| 风险 | 缓解 |
|---|---|
| dispatch 表顺序敏感（`page:N/heading:...` 必须在 `heading:...` 之前匹配） | 表按"最具体 → 最宽松"排序，测试用例覆盖组合 |
| heading title 含 `·` 或引号导致回显字符串歧义 | 仅用于 UI 展示，不用于机器解析，接受 |
| `stripPageMarkers` 正则误伤正文中出现的 `<!-- page: N -->` 字面量（极小概率） | 限定锚点 `^\s*...\s*$` + multiline，只剥独占行的注释 |
| Excel 回归失败 | 单测保留现 sheet/range 用例，先跑绿再改代码 |

## Security Considerations

N/A — 字符串处理，无外部输入升级。

## Next Steps

- Phase 6：端到端验收会通过 MCP client 实际调用 search tool 验证回显字符串
- Phase 5（blocked）：若决定加 ChunkMetadata `pageStart/pageEnd` 字段，本 phase 的"临时携带页码"方案可废弃

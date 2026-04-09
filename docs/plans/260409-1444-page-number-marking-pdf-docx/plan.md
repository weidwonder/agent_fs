---
title: "PDF/DOCX 解析增加页码标记 + Mapping locator 升级"
description: "为 PDF 和 Word 文档解析增加页码支持，便于 UI 跳页和搜索回显"
status: pending
priority: P2
effort: 6h
branch: main
tags: [plugin, pdf, docx, mapping, search]
created: 2026-04-09
---

# Plan: PDF/DOCX 页码标记 + Mapping Locator 升级

## 背景

详见 brainstorm 报告：[`./reports/brainstorm-260409-1444-page-number-marking-pdf-docx.md`](./reports/brainstorm-260409-1444-page-number-marking-pdf-docx.md)

**核心目标：** 让搜索结果可回显页码、UI 可按页跳转，不动 chunker、不扩 `PositionMapping` 类型。

**已锁定决策：**
- md 标记格式：`<!-- page: N -->`，每页首一条，独占一行前后空行
- PDF locator 保持 `page:N`；DOCX 升级为 `page:N/<原 locator>`（无页码时降级为旧格式）
- DOCX 页码源：NPOI `LastRenderedPageBreak`
- chunker、`PositionMapping` 类型零改动

## Phase 列表

| # | Phase | 文件 | Effort | 状态 |
|---|---|---|---|---|
| 1 | PDF 插件 md 注释插入 + mapping 行号重算 | [phase-01-pdf-plugin-page-markers.md](./phase-01-pdf-plugin-page-markers.md) | 1h | pending |
| 2 | DOCX .NET 侧 LastRenderedPageBreak + locator 升级 | [phase-02-docx-dotnet-page-detection.md](./phase-02-docx-dotnet-page-detection.md) | 2h | pending |
| 3 | DOCX TS 插件 parseLocator 升级 | [phase-03-docx-ts-parselocator-upgrade.md](./phase-03-docx-ts-parselocator-upgrade.md) | 0.5h | pending |
| 4 | mcp-server 搜索回显扩展 + chunk 内容剥离 | [phase-04-mcp-server-locator-display-extend.md](./phase-04-mcp-server-locator-display-extend.md) | 1h | pending |
| 5 | (OPTIONAL) chunk 页码回填 indexer | [phase-05-chunk-page-backfill.md](./phase-05-chunk-page-backfill.md) | 0.5h | blocked |
| 6 | 端到端验证与回归 | [phase-06-e2e-validation.md](./phase-06-e2e-validation.md) | 1h | pending |

## 关键依赖链

```
Phase 1 ─┐
          ├─> Phase 4 ─> Phase 6
Phase 2 ─┴─> Phase 3 ─┘
                       
Phase 5 (blocked, 需先回答遗留问题)
```

Phase 1、Phase 2 可并行。Phase 3 依赖 Phase 2 的 locator 格式。Phase 4 依赖 Phase 1+3。Phase 6 依赖全部。

## 遗留问题（阻塞 Phase 5）

以下问题需用户在进入 Phase 5 前回答：

1. **ChunkMetadata 是否加字段？** `packages/core/src/types/chunk.ts` 是否真的加 `pageStart?: number; pageEnd?: number`，还是只在 search 返回结构中临时携带页码？
   - 加字段：向量库数据层面持久化，查询便宜，但影响已有索引数据
   - 临时携带：每次查询查 mapping，indexer 零侵入，但 search 热路径略慢
2. **DOCX 完全无页码时，UI 跳页按钮怎么显示？** 隐藏？灰显？还是显示段落编号替代？
3. **是否需要"近似页码"标志位？** 防止 UI 误把 `LastRenderedPageBreak` 推断页当精确页展示？

未回答前 Phase 5 保持 `blocked` 状态，Phase 1–4+6 可独立交付。

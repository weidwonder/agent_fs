# Phase 05: (OPTIONAL/BLOCKED) chunk 页码回填 indexer

## Context Links

- Brainstorm: [`./reports/brainstorm-260409-1444-page-number-marking-pdf-docx.md`](./reports/brainstorm-260409-1444-page-number-marking-pdf-docx.md)
- 主计划: [`plan.md`](./plan.md)（遗留问题 1–3）
- 相关代码:
  - `packages/core/src/types/chunk.ts`
  - `packages/indexer/src/*`（具体文件待锁定）
- 上游依赖: Phase 1 + Phase 2（PDF/DOCX mapping locator 已升级）
- 下游依赖: 无

## Overview

- **Date:** 2026-04-09
- **Description:** 在 indexer 索引阶段，为每个 chunk 根据其 `lineStart/lineEnd` 查 mapping 回填 `pageStart/pageEnd`，让 UI 无需再二次查询即可跳页
- **Priority:** P2（可延后）
- **Implementation Status:** blocked
- **Review Status:** pending
- **Effort:** 0.5h

## Blocking Conditions

本 phase 需先回答主计划 [`plan.md`](./plan.md) 的三个遗留问题：

1. **ChunkMetadata 是否加 `pageStart/pageEnd` 字段？** 若否，本 phase 整个废弃，改由 Phase 4 的 "search 临时携带" 方案替代
2. **DOCX 完全无页码时 UI 跳页按钮如何处理？** 决定 `pageStart/pageEnd` 字段是 `undefined` 还是 `null`，以及 UI 层是否隐藏按钮
3. **是否加"近似页码"标志位？** 若是，ChunkMetadata 需再加 `isApproximatePage?: boolean`

**用户回答这三题之前，禁止开工本 phase。**

## Key Insights

- mapping 数组的 `originalLocator` 已含 `page:N`（PDF）或 `page:N/...`（DOCX 有页码时）
- chunk 的 `lineStart/lineEnd` 已由 chunker 给出，与 mapping `markdownRange` 在同一坐标系
- 回填算法：对每个 chunk 在 mapping 数组中找出 `markdownRange` 与 `[lineStart, lineEnd]` 有交集的所有 entry，解析其中的页码，取 min/max
- **性能：** O(chunks × mappings)。mapping 数 ≈ 段落数，实测可接受；若有热文档可先按 startLine 排序用二分优化
- 与 Phase 4 的关系：若本 phase 落地，Phase 4 的 displayLocator 改为优先读 chunk metadata.pageStart 而不是再查 mapping

## Requirements

**功能（假设决策 1 = 加字段）：**
- `ChunkMetadata` 加 `pageStart?: number; pageEnd?: number`
- indexer 在写入向量库前为每个 chunk 填充页字段（若 mapping 中存在页码信息）
- 无页码 mapping 的 chunk 这两个字段保持 `undefined`
- Phase 4 的 `resolveDisplayLocator` 逻辑可转为读 metadata（可选优化，不强制）

**非功能：**
- 重新索引一个已有文档时行为幂等
- 索引速度退化 < 10%（通过性能测试验证）

## Architecture

```
indexer pipeline:
  chunks = chunker(markdown)
  mappings = plugin.convert().positionMapping
  
         ↓  （新增步骤）
  
  for chunk in chunks:
    overlapping = mappings.filter(m => 
      m.markdownRange.endLine >= chunk.lineStart &&
      m.markdownRange.startLine <= chunk.lineEnd
    )
    pages = overlapping.map(m => extractPageFromLocator(m.originalLocator)).filter(Boolean)
    if pages.length > 0:
      chunk.metadata.pageStart = min(pages)
      chunk.metadata.pageEnd = max(pages)
  
  vectorDB.insert(chunks)
```

**`extractPageFromLocator`：** 支持两种格式
- `page:N` → N
- `page:N/<tail>` → N
- 其他 → null

## Related Code Files

**修改：**
- `packages/core/src/types/chunk.ts` — 加字段
- `packages/indexer/src/*` — 索引主循环（需先 scout 具体位置）
- `packages/indexer/src/*.test.ts` — 回填单测

**创建：** 无

**删除：** 无

## Implementation Steps

**前置：** 用户回答 3 个遗留问题，本 phase 解锁

1. 根据回答结果修订本 phase（字段名、是否加 flag 等）
2. 在 `chunk.ts` 添加 `pageStart?: number; pageEnd?: number`（若决策 3 = 是，加 `isApproximatePage?: boolean`）
3. scout 定位 indexer 的主索引函数（chunker 调用点 + 向量库写入点之间）
4. 抽 `extractPageFromLocator` 为 core 工具函数（放 `packages/core/src/utils/` 或就近 plugin helper）
5. 在 indexer 主循环内新增回填步骤
6. 补单测：
   - 多页 chunk 命中多 mapping 返回 min/max
   - 无页码 mapping 保持 undefined
   - 跨页 chunk 正确返回 `[pageStart=1, pageEnd=2]`
7. 运行 `pnpm --filter @agent-fs/core test` + `pnpm --filter @agent-fs/indexer test`
8. 可选：Phase 4 的 `resolveDisplayLocator` 重构为优先读 chunk metadata

## Todo list

- [ ] 等待用户回答 3 个遗留问题
- [ ] 更新本 phase 的字段设计
- [ ] 修改 `chunk.ts` 类型
- [ ] 抽 `extractPageFromLocator` 工具函数
- [ ] indexer 主循环加回填
- [ ] 单测覆盖 3 个典型场景
- [ ] `pnpm test` 全通过
- [ ] （可选）Phase 4 接入 metadata 优先读取

## Success Criteria

- ChunkMetadata 字段类型安全、可选
- indexer 单测覆盖多页 / 单页 / 无页码三种场景
- 重建索引同一文档幂等
- 索引速度退化 < 10%

## Risk Assessment

| 风险 | 缓解 |
|---|---|
| 用户的决策改变 Phase 4 方案 | 本 phase 显式 blocked，不与 Phase 4 抢先 |
| O(chunks × mappings) 在大文档慢 | 先按 startLine 排序 mapping，内循环二分；若无性能问题先上简单版 |
| 字段加到 ChunkMetadata 影响已有索引数据兼容 | 本项目已明确"不兼容旧结构"，重建索引即可 |
| `extractPageFromLocator` 重复实现于 Phase 1 | 抽到 core 工具模块，Phase 1 同步切换使用，避免 DRY 违背 |

## Security Considerations

N/A — 字符串解析与数据库写入，无外部输入升级。

## Next Steps

- Phase 6 端到端验收会覆盖 indexer 回填后的 UI 显示（若本 phase 落地）
- 若本 phase 废弃，UI 层改为接收 search 返回的 displayLocator 字符串解析页码（退而求其次）

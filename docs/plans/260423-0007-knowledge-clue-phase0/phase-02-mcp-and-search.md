# Phase 2 — MCP 工具与搜索集成

## Context Links

- 设计规格：`docs/specs/2026-04-22-knowledge-clue-phase0-design.md`
- 总览计划：`docs/plans/260423-0007-knowledge-clue-phase0/plan.md`
- Phase 1：`docs/plans/260423-0007-knowledge-clue-phase0/phase-01-core-and-storage-foundation.md`

## Overview

- Priority：P0
- Current status：completed
- Brief description：让 Clue 可以被 MCP Builder/Consumer 使用，并把 Clue 引用挂到搜索结果上。

## Key Insights

- MCP 输出应沿用现有 snake_case 风格，内部类型仍可保持 camelCase。
- `search` 只需要基于 `fileId -> leafPath` 扫描 Clue，即可实现低成本关联。
- `read_clue_leaf` 应复用现有 Markdown 原文读取路径，避免引入第二套内容读取逻辑。

## Requirements

- 暴露 `list_clues`、`browse_clue`、`read_clue_leaf`。
- 暴露 `clue_create`、`clue_delete`、`clue_add_folder`、`clue_add_leaf`、`clue_update_node`、`clue_remove_node`、`clue_get_structure`。
- `search` 在结果中附带 `clue_refs`，元素至少包含 `clue_id`、`clue_name`、`leaf_path`。

## Architecture

- MCP 工具层负责参数校验、项目解析和响应格式化。
- 树修改逻辑全部调用 `@agent-fs/core` 纯函数，不在工具层重复实现。
- `search` 通过 `storageAdapter.clue` 扫描命中文件的 Clue 引用，不改动检索主流程。

## Related Code Files

- Modify：`packages/mcp-server/src/server.ts`
- Modify：`packages/mcp-server/src/tools/search.ts`
- Create：`packages/mcp-server/src/tools/clue-storage.ts`
- Create：`packages/mcp-server/src/tools/clue-builder.ts`
- Create：`packages/mcp-server/src/tools/list-clues.ts`
- Create：`packages/mcp-server/src/tools/browse-clue.ts`
- Create：`packages/mcp-server/src/tools/read-clue-leaf.ts`
- Create：`packages/mcp-server/src/tools/clue-tools.test.ts`

## Implementation Steps

1. 先写 MCP 工具与 `search clue_refs` 的失败测试。
2. 实现 Builder/Consumer 工具文件并接入 `server.ts`。
3. 给 `search` 追加 Clue 关联逻辑，保持原有排序与内容补全不变。
4. 复跑 mcp-server 相关测试，确认输出格式稳定。

## Todo List

- [x] Clue 工具测试先失败
- [x] Builder/Consumer 工具实现通过
- [x] `search clue_refs` 测试先失败
- [x] `search clue_refs` 实现通过
- [x] MCP Server 工具注册完成

## Success Criteria

- `pnpm --filter @agent-fs/mcp-server test` 通过。
- 可以创建 Clue、浏览树、读取 leaf 正文。
- 搜索命中被 Clue 引用的文档时，结果附带正确的 `clue_refs`。

## Risk Assessment

- 风险：Builder 工具修改树时容易出现路径引用失效。
- Mitigation：工具层始终先读最新 Clue，再做单次纯函数变更并整体写回。

## Security Considerations

- 所有读写都基于已注册 project 或已存在 clue_id，不接受裸路径写入。
- `read_clue_leaf` 只透出已经被 Clue 引用的 Segment，不扩大现有原文访问权限。

## Next Steps

- 后续独立规划 LLM 自动构建、索引同步和 Electron UI。

# Knowledge Clue Phase 0 — 实施计划（修订版）

- 设计规格：`docs/specs/2026-04-22-knowledge-clue-phase0-design.md`
- 本轮目标：交付一个可独立验收的后端纵切面，让 Clue 能被创建、持久化、浏览、读取，并在搜索结果中挂接 `clue_refs`。

## 审阅结论

1. 原计划把“设计终态”直接展开为一次性交付，范围过大，缺少可验证的阶段边界。
2. 存储层设计写错了承载位置，Clue 必须落在 `<project>/.fs_index/clues/`，不能放到全局 `storagePath/clues/`。
3. 多处步骤与真实仓库不符，例如不存在的 `typecheck` 脚本、错误的测试文件路径、遗漏云端适配器补位。
4. LLM 自动构建、索引增量同步、Electron UI 目前都缺少可直接承接的稳定接口，不适合作为本轮必交范围。

## 本轮范围

- Phase 1：`@agent-fs/core` 的 Clue 类型、树操作与文本渲染能力。
- Phase 2：`@agent-fs/storage-adapter` 的本地 Clue 存储，按项目写入 `.fs_index/clues/`。
- Phase 3：`@agent-fs/mcp-server` 的 Clue Builder/Consumer 工具，以及 `search` 的 `clue_refs` 集成。

## Phase 状态

| Phase | 状态 | 文档 |
| --- | --- | --- |
| Phase 1: Core + 树操作 | completed | `docs/plans/260423-0007-knowledge-clue-phase0/phase-01-core-and-storage-foundation.md` |
| Phase 2: MCP + 搜索集成 | completed | `docs/plans/260423-0007-knowledge-clue-phase0/phase-02-mcp-and-search.md` |

## 验收口径

- 可以通过纯函数创建/修改/删除 Clue 树，并保证路径唯一性与路径重命名正确。
- Clue 文件可在项目 `.fs_index/clues/` 下读写，支持按项目列出、按 `clue_id` 获取和删除。
- MCP Server 暴露最小可用的 Clue 工具集，能够浏览结构、读取 leaf 正文并返回来源定位。
- `search` 返回结果在命中文档被 Clue 引用时，附带稳定的 `clue_refs`。

## 暂缓项

- LLM 主导的 Clue 创建向导与增量同步。
- Electron UI、IPC 事件与时间线可视化。
- 云端 Clue 持久化的正式实现，仅保留编译级占位。

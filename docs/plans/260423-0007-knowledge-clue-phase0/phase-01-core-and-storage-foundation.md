# Phase 1 — Core 与存储基础

## Context Links

- 设计规格：`docs/specs/2026-04-22-knowledge-clue-phase0-design.md`
- 总览计划：`docs/plans/260423-0007-knowledge-clue-phase0/plan.md`

## Overview

- Priority：P0
- Current status：completed
- Brief description：补齐 Clue 类型、树操作、渲染与本地持久化，为后续 MCP 工具提供稳定底座。

## Key Insights

- 路径是节点身份，树操作必须围绕“路径解析 + 局部不可变更新”实现。
- 根节点不应进入外部路径空间，外部路径仅描述 root 以下的节点。
- Clue 属于项目索引目录，持久化时必须通过 `projectId -> projectPath` 解析到 `.fs_index/clues/`。

## Requirements

- 定义 `Segment`、`Clue`、`ClueNode`、`ClueSummary` 等核心类型。
- 提供创建、查找、增删改、列举 leaf、渲染树的纯函数。
- 本地适配器支持 `listClues/getClue/saveClue/deleteClue`。
- 同一项目内 Clue 名称唯一；同层节点名称唯一。

## Architecture

- `@agent-fs/core`：放置类型和纯函数，不依赖 I/O。
- `@agent-fs/storage-adapter`：读取全局 registry 解析项目路径，在项目 `.fs_index/clues/` 目录下维护 `registry.json` 与 `<clue-id>.json`。
- 云端适配器本轮只补齐接口占位，避免编译断裂。

## Related Code Files

- Modify：`packages/core/src/index.ts`
- Create：`packages/core/src/types/clue.ts`
- Create：`packages/core/src/clue/tree.ts`
- Create：`packages/core/src/clue/tree.test.ts`
- Modify：`packages/storage-adapter/src/types.ts`
- Modify：`packages/storage-adapter/src/index.ts`
- Modify：`packages/storage-adapter/src/local/index.ts`
- Create：`packages/storage-adapter/src/local/local-clue-adapter.ts`
- Modify：`packages/storage-adapter/src/__tests__/local-adapter.test.ts`
- Modify：`packages/storage-cloud/src/cloud-adapter-factory.ts`

## Implementation Steps

1. 先补 `@agent-fs/core` 的失败测试，覆盖路径寻址、重命名、删除和渲染。
2. 实现核心类型与树操作函数，并从 `@agent-fs/core` 统一导出。
3. 再补本地存储适配器测试，覆盖项目级目录布局、唯一性约束和跨项目读取。
4. 实现 `LocalClueAdapter`，接入 `StorageAdapter` 与本地工厂。
5. 为云端工厂补齐 `clue` 占位实现，保证接口完整。

## Todo List

- [x] Clue 类型与树操作测试先失败
- [x] Clue 类型与树操作实现通过
- [x] LocalClueAdapter 测试先失败
- [x] LocalClueAdapter 实现通过
- [x] StorageAdapter 导出与工厂更新完成

## Success Criteria

- 核心树操作具备自动化测试覆盖。
- 项目目录下出现正确的 `.fs_index/clues/registry.json` 与 Clue 文件。
- `pnpm --filter @agent-fs/core test` 通过。
- `pnpm --filter @agent-fs/storage-adapter test` 通过。

## Risk Assessment

- 风险：路径重命名可能破坏子树寻址。
- Mitigation：以不可变重建方式更新父链，并对 rename 场景补专门测试。

## Security Considerations

- 通过 registry 解析项目路径时只接受已注册项目，避免写入任意目录。
- 读取 leaf 原文时只允许命中索引元数据中存在的 `fileId`。

## Next Steps

- 进入 Phase 2，实现 MCP 工具与搜索 `clue_refs`。

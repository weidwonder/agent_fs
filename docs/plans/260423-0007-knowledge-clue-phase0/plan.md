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
| Task 8: 文档变更 Clue 同步 | completed | — |

## 验收口径

- 可以通过纯函数创建/修改/删除 Clue 树，并保证路径唯一性与路径重命名正确。
- Clue 文件可在项目 `.fs_index/clues/` 下读写，支持按项目列出、按 `clue_id` 获取和删除。
- MCP Server 暴露最小可用的 Clue 工具集，能够浏览结构、读取 leaf 正文并返回来源定位。
- `search` 返回结果在命中文档被 Clue 引用时，附带稳定的 `clue_refs`。

## 暂缓项

- LLM 主导的 Clue 创建向导与增量同步。
- Electron UI、IPC 事件与时间线可视化。
- 云端 Clue 持久化的正式实现，仅保留编译级占位。

---

## Task 8: 文档变更 Clue 同步

**Spec ref:** Section 10 — 文档变更与 Clue 同步

**Files:**
- Create: `packages/core/src/clue/tree-remove.ts` — 添加 `removeLeavesByFileId` 与空目录级联清理逻辑
- Modify: `packages/core/src/clue/tree.ts` — 导出删除清理纯函数
- Modify: `packages/storage-adapter/src/types.ts` — ClueAdapter 新增 `removeLeavesByFileId` 方法
- Modify: `packages/storage-adapter/src/local/local-clue-adapter.ts` — 实现 `removeLeavesByFileId`
- Modify: `packages/indexer/src/pipeline.ts` — 删除路径调用 Clue 清理，新增/修改路径汇总 Webhook 事件
- Create: `packages/indexer/src/clue-webhook.ts` — Webhook 通知逻辑
- Modify: `packages/core/src/types/config.ts` — 新增 `clue.webhook_url` / `clue.webhook_secret` 配置项
- Test: `packages/core/src/clue/tree.test.ts` — 补充删除清理测试
- Test: `packages/storage-adapter/src/__tests__/local-adapter.test.ts` — 补充本地 Clue 清理测试
- Test: `packages/indexer/src/clue-webhook.test.ts` — Webhook 通知测试
- Test: `packages/indexer/src/pipeline.test.ts` — 补充删除同步与 Webhook 触发测试

### Part A: 删除同步（自动清理）

- [x] **Step 1:** 在 `packages/core/src/clue/tree-remove.ts` 添加 `removeLeavesByFileId(clue, fileId)` 纯函数
  - 递归遍历 Clue 树，移除所有 `segment.fileId === fileId` 的 leaf
  - 返回 `{ clue: Clue, removedLeaves: number, removedFolders: number }`

- [x] **Step 2:** 在同文件实现空目录级联清理逻辑
  - 递归移除 `children.length === 0` 的 folder 节点
  - root 节点保留，仅清理因删除而变空的子目录

- [x] **Step 3:** 为上述纯函数编写测试
  - 测试：leaf 被正确移除
  - 测试：空 folder 被级联移除
  - 测试：非空 folder 保留
  - 测试：fileId 不匹配时 Clue 不变

- [x] **Step 4:** 在 `ClueAdapter` 接口新增 `removeLeavesByFileId` 方法签名

- [x] **Step 5:** 在 `LocalClueAdapter` 实现该方法
  - 遍历项目所有 Clue → 调用 tree 纯函数 → 保存变更的 Clue

- [x] **Step 6:** 在 `pipeline.ts` 的删除路径调用 `storage.clue.removeLeavesByFileId(projectId, fileId)`
  - 修改文件时不自动删 leaf，避免覆盖 Section 10.2 的外部 LLM 分支

- [x] **Step 7:** 运行测试验证

- [x] **Step 8:** 实现完成

### Part B: Webhook 通知（新增/修改文档）

- [x] **Step 9:** 在 `packages/core/src/types/config.ts` 的 Config 接口中添加：
  ```typescript
  clue?: {
    webhook_url?: string;
    webhook_secret?: string;
  };
  ```

- [x] **Step 10:** 创建 `packages/indexer/src/clue-webhook.ts`
  ```typescript
  interface DocumentChange {
    fileId: string;
    filePath: string;
    action: 'added' | 'modified';
    summary: string;
  }

  async function notifyClueWebhook(
    webhookUrl: string,
    projectId: string,
    projectPath: string,
    changes: DocumentChange[],
    secret?: string
  ): Promise<void>
  ```
  - 构造 JSON payload
  - 若配置 secret，计算 HMAC-SHA256 签名放入 `X-Webhook-Signature` header
  - 使用 fetch POST 发送，fire-and-forget（catch 错误只 log 不抛）

- [x] **Step 11:** 编写 webhook 测试
  - Mock fetch，验证 payload 格式
  - 验证签名计算正确
  - 验证 fetch 失败不抛异常

- [x] **Step 12:** 在 `pipeline.ts` 索引完成后（写入 IndexMetadata 之后），调用 webhook 通知
  - 仅当 `config.clue?.webhook_url` 存在时触发
  - 收集本次索引的 added/modified 文件列表（不包括 deleted，已由 Part A 处理）
  - 异步发送，不阻塞索引流程

- [x] **Step 13:** 运行全部测试验证

- [x] **Step 14:** 实现完成

### 验证记录

- `pnpm exec vitest run packages/core/src/clue/tree.test.ts packages/core/src/config/schema.test.ts packages/storage-adapter/src/__tests__/local-adapter.test.ts packages/indexer/src/clue-webhook.test.ts packages/indexer/src/pipeline.test.ts packages/indexer/src/pipeline.integration.test.ts`
- `pnpm --filter @agent-fs/core build`
- `pnpm --filter @agent-fs/storage-adapter build`
- `pnpm --filter @agent-fs/storage-cloud build`
- `pnpm --filter @agent-fs/indexer build`

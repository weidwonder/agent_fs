# Phase 0: 契约冻结 + Conformance Tests

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 冻结 StorageAdapter 全部接口（包括 MetadataAdapter），回写 Spec，编写 conformance test suite 确保 Local 和 Cloud 两套实现行为一致。

---

## 为什么需要 Phase 0

审查发现 Spec、Phase 1 计划、现有代码三者之间的适配器定义已经漂移：
- Spec 用 `upsertChunks`，Phase 1 用 `addDocuments`
- `MetadataAdapter` 被定义但以 `null as any` 占位
- 现有 VectorStore 的 `softDelete/compact/countRows/updateFilePaths/filePathPrefix` 未被适配器覆盖

Phase 0 在写任何代码之前统一这些定义。

---

### Task 1: 审计现有 API 表面

- [ ] **Step 1: 列出现有 VectorStore 全部公开方法**

读取 `packages/search/src/vector-store/store.ts`，逐方法判断：
- 必须适配（主链路）：`init`, `addDocuments`, `searchByContent`, `getByChunkIds`, `deleteByFileId`, `deleteByDirId`, `deleteByDirIds`, `close`
- 可选适配（维护/诊断）：`softDelete`, `compact`, `countRows`, `updateFilePaths`
- 隐式行为需明确：`searchByContent` 的 `filePathPrefix`、`includeDeleted`、`distanceType`、`minResultsBeforeFallback`

- [ ] **Step 2: 列出现有 InvertedIndex 全部公开方法**

读取 `packages/search/src/inverted-index/inverted-index.ts`：
- 必须适配：`init`, `addFile`, `search`, `removeFile`, `removeDirectory`, `removeDirectories`, `close`

- [ ] **Step 3: 列出现有 AFDStorage 全部公开方法**

读取 `packages/storage/src/index.ts`：
- 必须适配：`write`, `read`, `readText`, `readBatch`, `exists`, `delete`

- [ ] **Step 4: 列出 IndexMetadata / Registry 的读写点**

Grep `readIndexMetadata`、`writeIndexMetadata`、`readRegistry`、`writeRegistry`、`index.json` 在 indexer/mcp-server/electron-app 中的所有调用点。产出一份清单。

---

### Task 2: 冻结 StorageAdapter 契约

基于 Task 1 的审计结果，定义最终接口。关键决策：

- [ ] **Step 1: 确定 VectorStoreAdapter 最终方法列表**

```typescript
interface VectorStoreAdapter {
  init(): Promise<void>;
  addDocuments(docs: VectorDocument[]): Promise<void>;
  searchByVector(params: VectorSearchParams): Promise<VectorSearchResult[]>;
  getByChunkIds(chunkIds: string[]): Promise<VectorDocument[]>;
  deleteByFileId(fileId: string): Promise<void>;
  deleteByDirId(dirId: string): Promise<void>;
  deleteByDirIds(dirIds: string[]): Promise<void>;
  close(): Promise<void>;
}

interface VectorSearchParams {
  vector: number[];
  dirIds: string[];
  topK: number;
  /** 本地实现使用 postfilter/prefilter 策略；云端实现可忽略此字段 */
  mode?: 'prefilter' | 'postfilter';
  minResultsBeforeFallback?: number;
}
```

决策记录：
- `softDelete` / `compact` / `countRows`：**不纳入适配器**，仅本地版 VectorStore 保留，由 Electron 直接调用
- `updateFilePaths`：**不纳入**，云端不使用路径语义
- `filePathPrefix`：**不纳入 VectorSearchParams**，所有 scope 必须解析为 dirIds 后再查询。Phase 2 需确保 MCP search 的 scope 解析逻辑在路径回退场景仍能工作

- [ ] **Step 2: 确定 InvertedIndexAdapter 最终方法列表**

保持 Phase 1 定义不变（已与现有 API 对齐）。

- [ ] **Step 3: 确定 DocumentArchiveAdapter 最终方法列表**

保持 Phase 1 定义不变。

- [ ] **Step 4: 定义 MetadataAdapter 完整契约**

```typescript
interface MetadataAdapter {
  // 目录索引元数据
  readIndexMetadata(dirId: string): Promise<IndexMetadata | null>;
  writeIndexMetadata(dirId: string, metadata: IndexMetadata): Promise<void>;
  deleteIndexMetadata(dirId: string): Promise<void>;

  // 子目录递归（用于 dir_tree / scope 解析）
  listSubdirectories(dirId: string): Promise<{ dirId: string; relativePath: string; summary?: string }[]>;

  // Registry 等价（用于 list_indexes）
  listProjects(): Promise<{ projectId: string; name: string; rootDirId: string; summary?: string }[]>;

  // Project memory（用于 get_project_memory）
  readProjectMemory(projectId: string): Promise<{ memoryPath: string; projectMd: string; files: { name: string; size: number }[] } | null>;
  writeProjectMemoryFile(projectId: string, fileName: string, content: string): Promise<void>;
}
```

决策记录：
- 本地实现：读写 `.fs_index/index.json` + `~/.agent_fs/registry.json` + `.fs_index/memory/`
- 云端实现：查询 `projects` / `directories` / `files` 表 + S3 memory 前缀

- [ ] **Step 5: 定义 StorageAdapter 生命周期**

```typescript
interface StorageAdapter {
  vector: VectorStoreAdapter;
  invertedIndex: InvertedIndexAdapter;
  archive: DocumentArchiveAdapter;
  metadata: MetadataAdapter;

  /** 初始化所有子适配器 */
  init(): Promise<void>;
  /** 关闭所有子适配器 */
  close(): Promise<void>;
}
```

工厂函数只组装对象，不做 I/O。调用方必须显式调 `init()` 和 `close()`。

---

### Task 3: 回写 Spec

- [ ] **Step 1: 更新 `docs/specs/2026-03-30-cloud-knowledge-base-design.md` §4**

将 §4 中的接口定义替换为 Task 2 冻结的最终版本。

- [ ] **Step 2: 补充 §4 决策记录**

在 Spec 中新增"接口设计决策"小节，记录 softDelete/compact/filePathPrefix 等排除理由。

- [ ] **Step 3: Commit**

```bash
git add docs/specs/2026-03-30-cloud-knowledge-base-design.md
git commit -m "docs(spec): freeze StorageAdapter contract with MetadataAdapter and lifecycle"
```

---

### Task 4: 编写 Conformance Test Suite

创建一组与后端无关的适配器行为测试，Local 和 Cloud 两套实现必须都能通过。

- [ ] **Step 1: 创建 conformance test 文件**

```
packages/storage-adapter/src/__tests__/conformance/
├── vector-store.conformance.ts
├── inverted-index.conformance.ts
├── archive.conformance.ts
└── metadata.conformance.ts
```

每个文件导出一个 `function describeVectorStoreConformance(factory: () => Promise<VectorStoreAdapter>)` 函数，内含标准测试用例。

- [ ] **Step 2: vector-store conformance 示例**

```typescript
export function describeVectorStoreConformance(
  name: string,
  factory: () => Promise<VectorStoreAdapter>,
  teardown: () => Promise<void>
) {
  describe(`VectorStoreAdapter conformance: ${name}`, () => {
    let adapter: VectorStoreAdapter;

    beforeAll(async () => { adapter = await factory(); await adapter.init(); });
    afterAll(async () => { await adapter.close(); await teardown(); });

    it('addDocuments + searchByVector returns matching results', async () => { ... });
    it('deleteByFileId removes all chunks for that file', async () => { ... });
    it('deleteByDirIds removes all chunks for those dirs', async () => { ... });
    it('getByChunkIds returns exact matches', async () => { ... });
    it('searchByVector with dirIds filters correctly', async () => { ... });
    it('searchByVector with empty dirIds returns all', async () => { ... });
  });
}
```

- [ ] **Step 3: Phase 1 的 LocalAdapter 测试改为调用 conformance suite**

```typescript
// packages/storage-adapter/src/__tests__/local-adapter.test.ts
import { describeVectorStoreConformance } from './conformance/vector-store.conformance';

describeVectorStoreConformance(
  'LocalVectorStoreAdapter',
  async () => { /* create local adapter */ },
  async () => { /* cleanup */ }
);
```

- [ ] **Step 4: Phase 3 的 CloudAdapter 测试也调用同一 conformance suite**

```typescript
// packages/storage-cloud/src/__tests__/cloud-vector.test.ts
import { describeVectorStoreConformance } from '@agent-fs/storage-adapter/conformance';

describeVectorStoreConformance(
  'CloudVectorStoreAdapter',
  async () => { /* create cloud adapter with test PG */ },
  async () => { /* cleanup */ }
);
```

- [ ] **Step 5: Commit**

```bash
git add packages/storage-adapter/src/__tests__/conformance/
git commit -m "test(storage-adapter): add conformance test suite for adapter contract verification"
```

---

## Phase 0 Success Criteria

- [ ] StorageAdapter 全部接口（含 MetadataAdapter）冻结，无 `null as any` 占位
- [ ] Spec §4 已回写为冻结版接口
- [ ] 决策记录明确哪些现有 API 被排除及原因
- [ ] Conformance test suite 可被 Local 和 Cloud 两套实现复用
- [ ] 生命周期规范明确：factory 只组装，init()/close() 显式调用

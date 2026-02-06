# Agent FS 架构文档

> 面向 AI Agent 的本地文档索引与检索系统（2026-02，存储优化版）

## 1. 系统定位

Agent FS 让 AI Agent 在本地完成“索引 → 检索 → 定位原文”的完整闭环：

1. 用户选择一个 Project 目录
2. Indexer 递归处理子目录与文件
3. 插件统一转换为 Markdown，并提供位置映射
4. 系统同时写入：
   - 向量索引（LanceDB）
   - 倒排索引（SQLite）
   - 原文归档（AFD，`.afd`）
5. MCP Server 对外提供 `search / get_chunk / list_indexes / dir_tree`

---

## 2. 核心设计目标

- **本地优先**：文档与索引均落地本机，不上传原文
- **混合召回**：向量召回 + 倒排召回 + RRF 融合
- **可定位**：每个 chunk 都可追溯到原文位置（locator + 行号）
- **可增量**：基于文件变更检测，仅重建变化文件
- **可层级检索**：支持 Project / 子目录 / 多目录范围检索

---

## 3. 分层架构

```
┌────────────────────────────────────────────────────────────┐
│ 应用层                                                     │
│ - @agent-fs/mcp-server（AI Agent 工具入口）               │
│ - @agent-fs/electron-app（索引管理与可视化）              │
├────────────────────────────────────────────────────────────┤
│ 索引编排层                                                 │
│ - @agent-fs/indexer（扫描、转换、切分、向量化、写入）     │
├────────────────────────────────────────────────────────────┤
│ 检索与模型层                                               │
│ - @agent-fs/search（VectorStore / InvertedIndex / RRF）   │
│ - @agent-fs/llm（Embedding / Summary）                    │
├────────────────────────────────────────────────────────────┤
│ 存储层                                                     │
│ - @agent-fs/storage（Rust N-API：AFD 读写）               │
│ - LanceDB（向量）                                          │
│ - SQLite（倒排）                                           │
├────────────────────────────────────────────────────────────┤
│ 插件层                                                     │
│ - plugin-markdown / plugin-pdf / plugin-docx / plugin-excel│
└────────────────────────────────────────────────────────────┘
```

---

## 4. 索引主流程（Indexer）

## 4.1 目录级递归构建

`IndexPipeline` 从 Project 根目录开始递归：

- 扫描当前目录文件与子目录
- 读取历史 `.fs_index/index.json`，做增量对比
- 为当前目录生成 `IndexMetadata`
- 递归处理子目录并回填聚合统计

每个目录都产出自己的 `.fs_index/index.json`，根目录额外承担 Project 入口角色。

## 4.2 文件级处理流水线

单文件处理步骤：

1. 插件 `toMarkdown()` 输出：
   - `markdown`
   - `mapping`
   - 可选 `searchableText`
2. `MarkdownChunker` 按结构切分 chunk
3. 生成 chunk 摘要（可按配置跳过）
4. 生成向量并写入 LanceDB（仅存向量与定位信息，不存大文本）
5. 写入 SQLite 倒排索引
6. 写入 AFD 文件（`content.md` + `metadata.json` + `summaries.json`）

## 4.3 增量更新机制

通过 `FileChecker` 判断文件是否变化：

- 小文件：哈希检测（MD5）
- 大文件：`size + mtime` 快速检测

变化类型与处理：

- **新增**：全量构建该文件索引
- **修改**：先删除旧索引，再重建该文件
- **删除**：清理向量、倒排与 AFD 归档

对子目录删除场景，系统会基于 `SubdirectoryInfo.fileIds` 做兜底清理，避免孤儿 AFD 文件残留。

---

## 5. 查询主流程（MCP Server）

## 5.1 `search`

1. 解析 `scope`（Project / 子目录 / 多目录）
2. 从 registry 展开目录范围并解析 `dirId`
3. 并行执行：
   - 向量召回（VectorStore）
   - 倒排召回（InvertedIndex）
4. 用 RRF 融合排序
5. 从 AFD 按需读取 chunk 文本并返回

## 5.2 `get_chunk`

- 通过 `chunk_id` 解析 `fileId`
- 递归遍历各级 `.fs_index/index.json` 定位文件
- 从 **Project 根** `.fs_index/documents` 读取对应 AFD
- 按行号范围（优先）或 locator（回退）截取正文
- 可附带邻近 chunk（前后文）

## 5.3 目录工具

- `list_indexes`：返回 registry 中有效 Project 与扁平化子目录引用
- `dir_tree`：返回递归目录树，支持 `depth` 限制，子索引缺失时返回回退节点

---

## 6. 关键数据模型

## 6.1 插件输出契约

```ts
interface DocumentConversionResult {
  markdown: string;
  mapping: PositionMapping[];
  searchableText?: SearchableEntry[];
}
```

`searchableText` 用于结构化文档（如 Excel）精确控制倒排召回文本。

## 6.2 目录索引元数据（`IndexMetadata`）

关键字段：

- `projectId`：Project 全局标识
- `relativePath`：相对 Project 的路径（根目录为 `.`）
- `parentDirId`：父目录 ID（根目录为 `null`）
- `files[]`：文件级元数据（含 `fileId`、`hash`、`chunkCount`）
- `subdirectories[]`：子目录信息（含 `fileIds`，用于删除清理）

## 6.3 全局注册表（`Registry` v2.0）

`~/.agent_fs/registry.json` 仅维护 Project：

- `projects[]`：Project 列表
- 每个 Project 包含扁平化 `subdirectories[]` 引用

系统不兼容旧版 registry 结构（如 `indexRoots`）；检测到旧结构会报错提示重建索引。

## 6.4 向量存储行结构（`VectorDocument`）

核心字段：

- `chunk_id`
- `file_id`
- `dir_id`
- `rel_path`
- `file_path`
- `chunk_line_start` / `chunk_line_end`
- `content_vector` / `summary_vector`
- `locator`
- `indexed_at` / `deleted_at`

说明：向量表已移除 `content/summary` 文本字段，大文本统一从 AFD 读取。

---

## 7. 存储布局

## 7.1 用户主目录（全局）

```
~/.agent_fs/
├── config.yaml
├── registry.json
└── storage/
    ├── vectors/                    # LanceDB
    └── inverted-index/
        └── inverted-index.db       # SQLite 倒排索引
```

## 7.2 Project 目录（本地索引）

```
<project>/
├── .fs_index/
│   ├── index.json                  # 根目录元数据
│   └── documents/
│       ├── <fileId>.afd            # AFD 归档
│       └── ...
├── <subdir>/
│   └── .fs_index/index.json        # 子目录元数据
└── ...
```

每个 `.afd` 内通常包含：

- `content.md`
- `metadata.json`（含 mapping）
- `summaries.json`

---

## 8. 插件与索引协作规则

- 插件必须提供稳定的 `locator`
- `mapping` 用于 chunk 与原文位置关联
- 若提供 `searchableText`，倒排索引优先使用它；否则回退到 chunk 内容
- `markdownLine` 必须是 1-based，并与最终 markdown 行号一致

详见：`docs/guides/plugin-development.md`

---

## 9. 测试与验证基线

当前关键验证包含：

- Indexer 单元与集成测试（含递归与增量）
- MCP 工具单测（`search / get_chunk / dir_tree / list_indexes`）
- E2E（Phase H）：
  - `packages/e2e/src/storage-optimization/phase-h.e2e.ts`
  - `packages/e2e/src/storage-optimization/phase-h-benchmark.e2e.ts`

性能基线（本地样本）在 Phase H.5 文档中记录：
`docs/plans/2026-02-05-storage-optimization-plan.md`

---

## 10. 已知边界

- `registry.json` 仅支持 v2.0 结构
- 旧 BM25 JSON 索引不再作为主链路
- 搜索质量依赖插件 `locator` 与 `searchableText` 质量

---

*文档版本：2.0*  
*更新日期：2026-02-06*

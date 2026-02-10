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
3. 生成 chunk 摘要（可按配置跳过；batch 模式支持按 `summary.parallel_requests` 并行请求）
4. 生成向量并写入 LanceDB（仅存向量与定位信息，不存大文本）
5. 写入 SQLite 倒排索引
6. 写入 AFD 文件（`content.md` + `metadata.json` + `summaries.json`）

说明：同一目录下文件处理支持按 `indexing.file_parallelism` 进行文件级并发（默认 2）。
说明：`docx` 插件在常规解析失败时会自动降级到 LibreOffice 文本提取链路，尽量保证 `.doc/.docx` 可索引。
说明：`embedding.default=api` 时可通过 `embedding.api.timeout_ms` 与 `embedding.api.max_retries` 控制向量请求超时与重试（默认 60000ms / 3 次）。
说明：每次索引会生成结构化运行日志：`<project>/.fs_index/logs/indexing.latest.jsonl`，包含 `file/stage/duration/detail`，用于定位卡点与超时阶段。
说明：对超长且无句号分隔的文本块，chunker 会执行硬切分，保证单个 chunk 不超过 `maxTokens`，避免向量化阶段因超大输入超时。
说明：Excel 转换时会按“有值/有公式”的实际单元格范围确定 sheet 边界，忽略仅有边框等样式但无内容的尾部区域。
说明：PDF 转换对 `Empty response from VLM server` 会触发整文件重试，并在重试时逐级降低 `maxConcurrency`（默认上限 4），降低大 PDF 并发请求压垮 VLM 服务的概率。

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

## 5. 查询主流程（MCP Server / Electron 客户端）

## 5.1 `search`

1. 解析 `scope`（Project / 子目录 / 多目录）
2. 解析检索范围：
   - 优先读取各目录 `.fs_index/index.json`，递归收集真实 `dirId`
   - 同时构建 `fileId -> {dirPath, filePath, afdName}` 映射，用于结果回填
   - 若目录缺少索引元数据，回退使用 registry 的 `projectId/subdirectories[].dirId`
3. 执行多路召回：
   - 向量召回（VectorStore，使用 `hybrid_vector = 0.5*content + 0.5*summary`）
   - 当 scope 展开为多个 `dirId` 时，向量召回使用一次查询并通过 `dirIds` 过滤，避免按目录循环导致 CPU 飙高
   - Electron 与 MCP 均使用单路 `hybrid_vector` 召回，不再重复查询 `content_vector/summary_vector` 两路
   - 向量检索优先使用 `postfilter`；仅当结果低于阈值（默认 `topK`，可配置）时回退 `prefilter`
   - VectorStore 初始化时会确保 `dir_id`、`chunk_id` 标量索引，用于加速 scope 过滤与按 `chunk_id` 回填
   - 倒排召回（InvertedIndex）
4. 用 RRF 融合排序
5. 从 AFD 按需读取 chunk 文本并返回
   - 优先用 chunk 行号范围回填正文；缺失时回退解析 `line/lines` locator
   - 行号补全通过 `chunk_id` 标量查询路径回填，避免走高开销向量回查
   - AFD 归档名优先使用 `index.json.files[].afdName`，不存在时回退 `name/fileId`
   - Excel 结果展示优先使用 `sheet:<sheet>/range:<A1:B2>` 定位符；仅在无法映射时回退 `line/lines`

## 5.1.1 Electron `remove-project` 体验

- 先从 registry 移除项目入口并立即返回，避免前端长时间无反馈
- `.fs_index`、向量库、倒排索引删除在后台异步执行
- 后台清理状态通过 IPC 事件推送到前端（开始/完成/失败）

## 5.1.2 `prefilter` / `postfilter` 策略与召回影响

- `prefilter`：先按 `dir_id/file_path` 等条件过滤，再做向量检索；召回更稳，但在多目录与复杂过滤下延迟更高
- `postfilter`：先做向量检索再过滤范围；延迟更低，但在极窄范围场景可能损失部分长尾候选
- 当前实现采用“`postfilter` 优先 + `prefilter` 回退”：
  - 若 `postfilter` 结果数 >= `minResultsBeforeFallback`，直接使用
  - 若不足，则自动回退 `prefilter` 兜底
- Electron 与 MCP 当前都将 `minResultsBeforeFallback` 设为 `topK`，优先保障最终返回条数并控制延迟
- 如后续业务需要更保守的召回，可提高该阈值（如 `topK*2` / `topK*3`），代价是更高查询耗时

## 5.2 `get_chunk`

- 通过 `chunk_id` 解析 `fileId`
- 递归遍历各级 `.fs_index/index.json` 定位文件
- 从 **文件所在目录** `.fs_index/documents` 读取对应 AFD
- 按行号范围（优先）或 locator（回退）截取正文
- 可附带邻近 chunk（前后文）

## 5.3 `get_project_memory`

- 输入 `project`（支持 `projectId` 或项目路径）
- 读取 `<project>/.fs_index/memory/`
- 返回：
  - `memoryPath`（绝对路径，供 AI Agent 文件工具读写）
  - `projectMd`（`project.md` 内容）
  - `files`（memory 下 markdown 文件列表与大小）
- memory 数据不参与向量索引与倒排索引，仅作为项目记忆存储

## 5.4 目录工具

- `list_indexes`：返回 registry 中有效 Project 与扁平化子目录引用
- `dir_tree`：返回递归目录树，支持 `depth` 限制，子索引缺失时返回回退节点

## 5.5 Electron 客户端查询链路

- 通过 `ipcMain.handle('search')` 复用同一套向量/倒排/RRF 能力
- `get-registry` 会将相对路径解析为绝对路径，并过滤被父目录包含的重复条目
- `get-project-memory` / `save-memory-file` 用于读写项目 memory（`project.md` 与 `extend/*.md`）
- 相对路径解析策略按优先级：
  1. workspace 根目录（包含 `pnpm-workspace.yaml`）
  2. `INIT_CWD`
  3. `process.cwd()`
- 启动前执行 `electron-rebuild`，保证 `better-sqlite3` / `nodejieba` / `canvas` 与 Electron ABI 一致
- `native:electron` 使用非强制重建模式（不带 `-f`），无变更时可跳过重复编译；重建后会执行 `scripts/ensure-electron-native.mjs`，通过 `ELECTRON_RUN_AS_NODE=1` 探测 native 模块加载；若检测到 macOS 签名损坏（`code signature does not cover entire file...`）会自动重签名后复检

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
- `content_vector` / `summary_vector` / `hybrid_vector`
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
│   ├── memory/                     # 项目结构记忆（不参与索引）
│   │   ├── project.md              # 项目介绍
│   │   └── extend/                 # 项目经验扩展
│   └── documents/                  # 根目录文件的 AFD
│       ├── root.md.afd
│       └── ...
├── <subdir>/
│   └── .fs_index/
│       ├── index.json              # 子目录元数据
│       └── documents/              # 子目录文件的 AFD
│           ├── doc.docx.afd
│           └── ...
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
- Electron 查询范围解析单测：`packages/electron-app/src/main/search-scope.test.ts`
- Electron 构建前原生依赖重建：`pnpm --filter @agent-fs/electron-app run predev`
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
- 若切换 Node/Electron 版本导致 ABI 变化，需重新执行 Electron 端原生模块重建

---

*文档版本：2.2*  
*更新日期：2026-02-09*

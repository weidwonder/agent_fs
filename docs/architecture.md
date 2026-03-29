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
3. 生成文档摘要（直接基于完整 markdown；超过 10K token 时回退为“前 1K token 正文 + 全部章节标题”）
4. 生成向量并写入 LanceDB（仅存 `content_vector` 与定位信息，不存大文本）
5. 写入 SQLite 倒排索引
6. 写入 AFD 文件（`content.md` + `metadata.json` + `summaries.json`）

说明：同一目录下文件处理支持按 `indexing.file_parallelism` 进行文件级并发（默认 2）。
说明：`docx` 插件在常规解析失败时会自动降级到 LibreOffice 文本提取链路，尽量保证 `.doc/.docx` 可索引。
说明：`embedding.default=api` 时可通过 `embedding.api.timeout_ms` 与 `embedding.api.max_retries` 控制向量请求超时与重试（默认 60000ms / 3 次）。
说明：每次索引会生成结构化运行日志：`<project>/.fs_index/logs/indexing.latest.jsonl`，包含 `file/stage/duration/detail`，用于定位卡点与超时阶段。
说明：对超长且无句号分隔的文本块，chunker 会执行硬切分，保证单个 chunk 不超过 `maxTokens`，避免向量化阶段因超大输入超时。
说明：Excel 转换时会按“有值/有公式”的实际单元格范围确定 sheet 边界，忽略仅有边框等样式但无内容的尾部区域。
说明：PDF 转换对 `Empty response from VLM server` 会触发整文件重试，并在重试时逐级降低 `maxConcurrency`（默认上限 4）；同时对单页可重试错误会执行页级重试（默认 2 次），耗尽后默认跳过失败页，避免单页异常导致整文件失败。

## 4.3 增量更新机制

通过 `FileChecker` 判断文件是否变化：

- 小文件：哈希检测（MD5）
- 大文件：`size + mtime` 快速检测

变化类型与处理：

- **新增**：全量构建该文件索引
- **修改**：先删除旧索引，再重建该文件
- **删除**：清理向量、倒排与 AFD 归档
- **中断恢复**：
  - 索引过程中会持续写入 `<project>/.fs_index/index.resume.json`（按文件级更新）
  - 若上次中断且根 `index.json` 尚未生成，下次启动会优先读取该快照恢复已完成文件清单
  - 对“未变更 + AFD 归档仍存在”的文件直接跳过，避免重复转换/向量化
  - 若快照记录存在但 AFD 缺失，则自动回退为重建流程（先清理旧索引再重建）
  - 本次索引完整成功后会自动删除该快照文件

Electron 客户端在知识库卡片设置中提供三种手动操作：

- **增量更新**：仅处理新增/变更/删除文件
- **补全 Summary**：基于 AFD（`content.md` 与 `summaries.json`）仅补齐缺失的 document/directory 摘要
- **补全 Summary 并发**：目录内文件并发遵循 `indexing.file_parallelism`；LLM 请求并发遵循 `summary.parallel_requests`
- **重新索引**：清理当前目录 `.fs_index` 与对应向量/倒排数据后全量重建
- 维护弹窗会实时显示当前阶段进度、文档/目录摘要覆盖率刷新结果，以及日志尾部（增量/重建读取 `indexing.latest.jsonl`，补全摘要读取 `summary-backfill.latest.jsonl`）

对子目录删除场景，系统会基于 `SubdirectoryInfo.fileIds` 与 `fileArchives` 做兜底清理，避免子索引缺失时残留孤儿向量、倒排记录或 AFD 归档。

---

## 5. 查询主流程（MCP Server / Electron 客户端）

## 5.1 `search`

1. 解析 `scope`（Project / 子目录 / 多目录）
2. 解析检索范围：
   - 优先读取各目录 `.fs_index/index.json`，递归收集真实 `dirId`
   - 同时构建 `fileId -> {dirPath, filePath, afdName}` 映射，用于结果回填
   - 若目录缺少索引元数据，回退使用 registry 的 `projectId/subdirectories[].dirId`
3. 执行多路召回：
   - 向量召回（VectorStore，使用 `content_vector`）
   - 当 scope 展开为多个 `dirId` 时，向量召回使用一次查询并通过 `dirIds` 过滤，避免按目录循环导致 CPU 飙高
   - Electron 与 MCP 均使用单路 `content_vector` 召回
   - 向量检索优先使用 `postfilter`；仅当结果低于阈值（默认 `topK`，可配置）时回退 `prefilter`
   - VectorStore 初始化时会确保 `dir_id`、`chunk_id` 标量索引，用于加速 scope 过滤与按 `chunk_id` 回填
   - 倒排召回（InvertedIndex）
4. 用 RRF 融合排序后按文件聚合：
   - 同一文件只保留一个代表 chunk 进入 TopK
   - 记录该文件命中 chunk 数，并按命中数对代表项做分数加权提升
   - 代表 chunk 会结合关键词快照、标题/条款锚点和首段命中情况做二次重选，减少“文件对了但首屏段落不对”的情况
5. 从 AFD 按需读取 chunk 文本并返回
   - 优先用 chunk 行号范围回填正文；缺失时回退解析 `line/lines` locator
   - 行号补全通过 `chunk_id` 标量查询路径回填，避免走高开销向量回查
   - AFD 归档名优先使用 `index.json.files[].afdName`，不存在时回退 `name/fileId`
   - Excel 结果展示优先使用 `sheet:<sheet>/range:<A1:B2>` 定位符；仅在无法映射时回退 `line/lines`
6. 返回结果附带聚合元数据：
   - `chunk_hits`：该文件在候选集中命中的 chunk 数
   - `aggregated_chunk_ids`：参与聚合的 chunk_id 列表
   - `keyword_snippets`：当请求包含 `keyword` 时，返回同文件关键词命中 chunk 的局部快照；若其对应 chunk 更优，也会参与代表 chunk 重选

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
- `get-project-overview` 基于递归读取 `index.json` 计算项目概况、索引版本与文档/目录 Summary 覆盖率
- `get-indexing-log` 读取 `.fs_index/logs/*.latest.jsonl` 尾部内容，供前端维护弹窗轮询展示
- `get-registry` 会将相对路径解析为绝对路径，并过滤被父目录包含的重复条目
- `get-project-memory` / `save-memory-file` 用于读写项目 memory（`project.md` 与 `extend/*.md`）
- 相对路径解析策略按优先级：
  1. workspace 根目录（包含 `pnpm-workspace.yaml`）
  2. `INIT_CWD`
  3. `process.cwd()`
- 启动前执行 `electron-rebuild`，保证 `better-sqlite3` / `nodejieba` / `canvas` 与 Electron ABI 一致
- `native:electron` 通过 `electron-rebuild -m ../../ --force` 在 workspace 根目录强制重建 `better-sqlite3` / `nodejieba` / `canvas`；重建后会执行 `scripts/ensure-electron-native.mjs`，通过 `ELECTRON_RUN_AS_NODE=1` 实际执行 SQLite 内存查询与 `nodejieba.cut` 进行探测；若检测到 macOS 签名损坏（`code signature does not cover entire file...`）会自动重签名后复检
- `@agent-fs/search` 必须显式声明 `apache-arrow` 运行时依赖；`@lancedb/lancedb` 仅通过 peer dependency 约束 Arrow 版本，Electron 打包产物不能依赖 workspace hoist“碰巧可用”
- `@agent-fs/plugin-docx` 的 `build` 必须先执行 `build:dotnet`，并且 Electron 打包时需将 `plugin-docx/dotnet/**` 解包到 `app.asar.unpacked`；外部 `dotnet` 进程不得直接读取 `app.asar` 内路径
- `@agent-fs/plugin-excel` 的 `build` 必须先执行 `build:dotnet`，运行时优先启动 `dist/dotnet/ExcelConverter` 发布可执行文件；仅在本地开发兜底时才回退 `dotnet run --project <csproj>`
- Electron 打包产物必须额外将 `DocxConverter` / `ExcelConverter` 复制到 `Contents/Resources/converters/{docx,excel}`，运行时优先从该目录解析，避免依赖 `app.asar` 或 workspace 包路径
- `scripts/install_macos.sh` 安装完成后必须执行 `scripts/verify-packaged-app.mjs` 烟测；除校验 `apache-arrow`、`Contents/Resources/converters/` 下转换器产物存在外，还必须通过打包后 JS 入口实际启动 `ConverterClient`
- Renderer 侧索引失败提示需支持手动关闭，避免一次失败后错误提示常驻遮挡后续操作

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
- `indexedWithVersion`：生成该目录索引时的程序版本
- `files[]`：文件级元数据（含 `fileId`、`hash`、`chunkCount`）
- `subdirectories[]`：子目录信息（含 `fileIds` 与 `fileArchives`，用于目录缺失场景的删除清理）

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
- `content_vector`
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
│   ├── index.resume.json           # 中断恢复快照（仅索引未完成时存在）
│   ├── logs/
│   │   ├── indexing.latest.jsonl   # 增量/重建最新日志
│   │   └── summary-backfill.latest.jsonl
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
- `summaries.json`（仅保存 `documentSummary`）

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

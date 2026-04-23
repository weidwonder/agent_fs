# Agent FS 需求文档

> 面向 AI Agent 的文件系统智能索引工具

## 1. 项目目标

为 AI Agent 提供本地文档的智能检索能力：
- 用户指定文件夹 → 自动索引文档内容 → AI Agent 通过 MCP 查询

## 2. 核心功能

### 2.1 文档索引

| 需求 | 说明 |
|------|------|
| 支持格式 | PDF / DOCX / DOC / XLSX / XLS / Markdown / TXT |
| 索引范围 | **Project 文件夹及其所有子文件夹（递归索引）** |
| 层级结构 | Project 文件夹（顶级）包含多个子文件夹，每个文件夹独立的 `.fs_index` |
| 索引存储 | 每个文件夹下创建 `.fs_index` 目录，存储该文件夹的索引 |
| 全局注册 | `~/.agent_fs/registry.json` 只记录 Project 文件夹 |

### 2.2 文档处理流程

```
原始文档
    ↓
[插件] 转换输出
    ├─ markdown: 语义化视图（用于展示、向量化）
    └─ searchableText: 可选，用于倒排索引（结构化插件提供）
    ↓
[MarkdownChunker] 基于 markdown 按结构切分
    ↓
超大块(>0.8K token) → SentenceSplitter 再切分
    ↓
每个 chunk 目标: 0.4-0.8K token，不切开段落和句子
    ↓
[LLM] 生成文档 summary（直接基于 markdown；超过 10K token 时回退为“前 1K token 正文 + 全部章节标题”）
    ↓
[Embedding] 向量化 chunk 内容
    ↓
[存储]
    ├─ 向量库: chunk 内容向量（不存文本）
    ├─ 倒排索引: searchableText 构建索引（持久化到 SQLite）
    └─ AFD 文件: markdown 与文档摘要压缩存储（.afd 格式）
    ↓
汇总生成目录 summary
```

### 2.3 索引内容

| 层级 | 索引内容 | 存储位置 |
|------|----------|----------|
| Chunk | chunk 内容向量、chunk 在 markdown 的行范围 | 向量库（LanceDB） |
| 倒排索引 | term → {chunk_id, locator, tf, positions} | SQLite（文件级 BLOB） |
| 文档内容 | markdown（语义化）、metadata | .afd 压缩文件 |
| 文档元数据 | 文件名、hash、fileId、chunkCount、summary | .fs_index/index.json |
| 目录元数据 | summary、文件列表、子目录列表、层级信息 | .fs_index/index.json |

### 2.4 搜索能力

| 需求 | 说明 |
|------|------|
| 多路召回 | 向量搜索(content_vector) + 倒排索引关键词搜索 |
| 融合排序 | RRF（倒数排名融合） |
| 结果聚合 | RRF 结果按文档聚合后返回；同一文件只保留一个代表 chunk 进入 TopK，并记录该文件的命中 chunk 数；代表 chunk 可结合关键词命中、标题/条款锚点做二次重选 |
| 可选 Rerank | 支持 LLM Rerank |
| 查询类型 | 语义查询 + 精准关键词查询（可同时使用） |
| 查询范围 | 单/多个 Project 或子文件夹，**自动包含所有子文件夹** |
| 层级过滤 | 指定 Project 文件夹 → 搜索全部；指定子文件夹 → 仅搜索该子树 |
| 范围解析一致性 | scope 传入 Project 时，优先基于 `.fs_index/index.json` 递归解析真实 `dirId`；索引缺失时回退 registry |
| 结果元数据 | 搜索结果返回代表 chunk 的 `chunkId`，并可附带 `chunkHits` / `aggregatedChunkIds` 说明同文件聚合命中情况；当传入 `keyword` 时，可额外返回 `keywordSnippets` 展示关键词命中片段快照，并作为代表 chunk 重选的信号之一；若命中文件被知识线索引用，MCP 响应还可返回 `clue_refs`（`clue_id / clue_name / leaf_path`） |

### 2.5 增量更新

| 操作 | 说明 |
|------|------|
| 新增文档 | 检测新文件 → 执行完整索引流程 |
| 删除文档 | 检测已删除文件 → 从索引中移除 |
| 文档修改 | **检测文件变更 → 重建该文件索引** |
| 变更检测 | 文件 ≤200MB: MD5 哈希；文件 >200MB: 大小+修改时间 |
| 触发方式 | 手动触发（暂不支持自动检测） |
| 手动动作 | 增量更新 / 补全 Summary / 重新索引 |
| 补全 Summary | 基于 AFD（`content.md`/`summaries.json`）补齐缺失的 document/directory summary |
| 补全并发策略 | 文件级并发遵循 `indexing.file_parallelism`；LLM 请求并发遵循 `summary.parallel_requests` |
| 文档摘要输入 | 默认直接使用完整 markdown；超过 10K token 时回退为“前 1K token 正文 + 全部章节标题” |
| OpenAI 兼容约束 | Summary 请求需显式关闭 thinking，避免模型将内容写入 reasoning 字段 |
| 限流保护 | Summary 请求需做全局队列限流、最小请求间隔与 `429` 退避重试 |
| 执行可观测性 | 维护弹窗实时展示进度（阶段/文件）与日志尾部，并刷新 summary 覆盖率 |

### 2.6 知识线索（Knowledge Clue）Phase 0

| 需求 | 说明 |
|------|------|
| 组织隐喻 | Clue 采用“文件系统”隐喻：folder 表示目录，leaf 表示指向文档片段的文件 |
| 节点寻址 | 节点通过路径定位，不暴露节点 ID；同层节点不允许重名 |
| 组织模式 | 当前支持 `tree` 和 `timeline` 两种 folder 组织模式，可混合嵌套 |
| 内容粒度 | leaf 指向 `Segment`，支持整个文档（`document`）或行号区间（`range`） |
| 当前创建方式 | Phase 0 通过 MCP Builder 工具显式创建与维护，不依赖 LLM 自动生成 |
| 当前浏览方式 | 通过 `list_clues / browse_clue / read_clue_leaf` 浏览结构、读取正文与来源定位 |
| 当前范围 | 已落地 Core 类型、树操作、本地存储、MCP 工具、搜索 `clueRefs` 挂接 |
| 暂未覆盖 | LLM 自动构建、Indexer 自动同步、Electron Clue UI |

## 3. 系统架构要求

### 3.1 插件式设计

| 要求 | 说明 |
|------|------|
| 文档处理插件 | 每种文件格式一个插件，互不干扰 |
| 插件实现 | TypeScript 模块，内部可封装外部程序调用（如 C#） |
| 插件声明 | 每个插件声明自己支持的文件后缀 |
| 插件分级 | **文本类**（Markdown/PDF/DOCX）输出完整文本；**结构化类**（Excel）输出语义化+可搜索文本 |
| 输出格式 | `markdown`（必需）+ `searchableText`（可选，结构化插件提供） |
| searchableText | 多对一关系：多个 searchableText entry 对应同一个 markdown 行，每个 entry 带 locator |
| 位置映射 | 插件定义 `locator` 格式（如 `Sheet1!A1:C100`），主程序不解析 |

### 3.2 扁平架构

```
底层: 脚手架工具（配置、类型、通用工具）
  ↓
中层: 核心服务（索引、搜索、LLM）
  ↓
上层: 应用（MCP Server、Electron 客户端）
```

- 尽可能减少组件依赖
- 高内聚低耦合
- 支持并行开发

### 3.3 两个独立程序

| 程序 | 职责 | 运行方式 |
|------|------|----------|
| Electron 客户端 | 创建/管理索引、配置、查看状态 | 用户按需启动 |
| MCP Server | 响应 AI Agent 查询 | 本地常驻 Streamable HTTP 服务，默认 `http://127.0.0.1:3001/mcp` |

### 3.4 全局存储

位置: `~/.agent_fs/`

| 文件/目录 | 用途 |
|----------|------|
| `config.yaml` | 全局配置（LLM/Embedding/Rerank 等） |
| `registry.json` | 已索引 **Project 文件夹**列表（含子文件夹扁平化引用） |
| `storage/vectors/` | LanceDB 向量库（存向量，不存文本） |
| `storage/inverted-index/inverted-index.db` | SQLite 倒排索引（文件级 BLOB 存储） |
| `storage/cache/` | Embedding 缓存 |

### 3.5 本地索引存储

每个文件夹的 `.fs_index/` 结构：

| 文件/目录 | 用途 |
|----------|------|
| `index.json` | 目录元数据（文件列表、子目录列表、层级信息、`indexedWithVersion`） |
| `index.resume.json` | 索引中断恢复快照，仅在根目录索引未完成时存在 |
| `logs/*.latest.jsonl` | 增量/重建与补全 Summary 的最新运行日志 |
| `memory/project.md` | 项目级记忆入口（项目介绍与索引摘要） |
| `memory/extend/*.md` | 项目经验扩展记忆（约定在 project.md 引用） |
| `clues/registry.json` | 当前 Project 下的 Clue 列表索引 |
| `clues/<clue-id>.json` | 单个 Clue 的完整结构化数据 |
| `documents/<原文件名>.afd` | 当前目录文件对应的压缩归档（ZIP，含 content.md、metadata.json、summaries.json，其中 `summaries.json` 仅保存 `documentSummary`） |

## 4. 索引存储优化

### 4.1 倒排索引（Inverted Index）

| 特性 | 说明 |
|------|------|
| 存储引擎 | SQLite |
| 索引粒度 | 文件级（file_id），BLOB 存储 posting list |
| 索引内容 | term → {chunk_id, locator, tf, positions} |
| 查询优化 | 复合索引 `(term, dir_id, tf_sum)` 支持目录过滤 |
| 更新策略 | 增量更新：按 file_id 删除旧索引，插入新索引 |

### 4.2 文档存储（AFD 格式）

| 特性 | 说明 |
|------|------|
| 格式 | `.afd` 文件（ZIP 压缩） |
| 文件命名 | 保持原文件名并追加 `.afd`（示例：`demo.docx.afd`） |
| 内部结构 | `content.md`（markdown）、`metadata.json`（可选） |
| 实现 | Rust native 模块（@agent-fs/storage） |
| 压缩算法 | DEFLATE (level 6) |
| 性能优化 | LRU 缓存、零拷贝 mmap、并行读取 |
| 压缩率 | 60-80% 空间节省 |
| 读取性能 | 首次 <10ms，缓存命中 <1ms（50KB 文件） |

### 4.3 向量存储优化

| 优化项 | 说明 |
|--------|------|
| 存储内容 | 仅存向量（content_vector） |
| 移除字段 | content、summary 文本字段（从 AFD 读取） |
| 新增字段 | file_id、chunk_line_start、chunk_line_end（用于定位 AFD） |
| 空间节省 | 向量库体积减少 70-80% |

## 5. MCP Tools

| Tool | 用途 |
|------|------|
| `list_indexes` | 列出所有已索引 **Project 文件夹**及其 summary（含子文件夹树） |
| `dir_tree` | 展示目录结构（文件/子目录的 summary） |
| `glob_md` | 枚举指定范围内可读取的 Markdown 原文文件 |
| `read_md` | 读取指定文档的 Markdown 全文或指定行范围 |
| `grep_md` | 在 Markdown 原文里做精确文本搜索并返回上下文 |
| `search` | 多路召回搜索（语义 + 精准关键词），支持多文件夹过滤 |
| `get_chunk` | 获取指定 chunk 详情及相邻 chunk（从 AFD 读取） |
| `get_project_memory` | 获取项目 memory 路径、project.md 内容和 markdown 文件列表 |
| `list_clues` | 列出指定项目下的知识线索摘要与 leaf 统计 |
| `browse_clue` | 浏览 Clue 的树结构（仅名称、类型、摘要） |
| `read_clue_leaf` | 读取指定 leaf 的正文与来源定位 |
| `clue_create` | 创建 Clue 根结构 |
| `clue_delete` | 删除指定 Clue |
| `clue_add_folder` | 在 Clue 中新增 folder 节点 |
| `clue_add_leaf` | 在 Clue 中新增 leaf 节点 |
| `clue_update_node` | 更新 Clue 节点名称、摘要或 Segment 锚点 |
| `clue_remove_node` | 删除 Clue 节点及其子树 |
| `clue_get_structure` | 读取 Clue 文本树结构 |

## 6. 用户界面

| 要求 | 说明 |
|------|------|
| 框架 | Electron + React |
| 风格 | 极简档案馆（类 Notion/Linear） |
| 核心功能 | 选择目录、启动索引、查看进度、管理配置、执行语义/精准搜索（支持范围选择）、查看项目概况 |
| 进度展示 | 当前文件、已完成/总数、索引更新时间 |
| 项目概况 | 展示文件数、已索引文件数、chunk 数、索引版本、文档/目录 Summary 覆盖率，并支持从概况面板触发增量更新 / 补全 Summary / 重新索引 |
| 知识线索 | 当前 Electron 客户端尚未提供 Clue 列表、树浏览或创建向导；Phase 0 仅落地后端与 MCP 能力 |
| 布局约束 | 左侧项目面板与右侧搜索面板并排显示，列表卡片不得横向溢出或被搜索面板遮挡 |

## 7. 可配置项

| 配置项 | 说明 |
|--------|------|
| LLM | OpenAI 兼容 API（base_url / key / model） |
| Summary | mode / parallel_requests / timeout_ms / max_retries |
| Embedding | 本地模型（默认）或 API；API 支持 `timeout_ms / max_retries` |
| Rerank | 可选，支持 LLM Rerank |
| 索引参数 | chunk_size.min_tokens / chunk_size.max_tokens / indexing.file_parallelism |
| 搜索参数 | top_k、融合方法 |
| 插件参数 | 各插件自定义参数 |

## 8. 跨平台支持

| 平台 | 优先级 |
|------|--------|
| Windows | 必须支持 |
| macOS | 尽量支持 |
| Linux | 尽量支持 |

## 9. 不支持文件处理

- 只记录文件名到 `unsupported_files` 列表
- 不做任何索引处理
- AI Agent 可通过 `dir_tree` 知道这些文件存在

## 10. 中文支持

| 组件 | 中文支持方案 |
|------|-------------|
| Embedding | 使用支持中文的模型（如 bge-small-zh） |
| 倒排索引 | 使用 nodejieba 中文分词 |
| Summary | 依赖 LLM 能力 |

## 11. 约束与边界

### 暂不实现

- 自动检测文件变化（需手动触发重新索引）
- 图片/音视频等非文档格式
- searchableText 原始明细不单独持久化（每次重建索引时重新生成）
- LLM 主导的 Clue 对话式创建与自动展开
- Indexer 管线末尾自动同步 Clue
- Electron 客户端中的 Clue 列表、树浏览器与创建向导

### 技术约束

- 向量搜索为主，倒排索引为辅
- 文件变更检测基于哈希/时间戳，无法检测内容细微变化
- Electron 客户端依赖 `better-sqlite3` / `nodejieba` 原生模块，需与 Electron ABI 匹配
- `.doc/.docx` 转换依赖 `plugin-docx`（含 LibreOffice 降级链路），极端文档仍可能出现兼容性差异
- Apple Silicon 环境默认使用 Node.js 20（arm64）进行开发与启动

## 12. 性能指标

### 12.1 索引性能

| 指标 | 目标 |
|------|------|
| 单文件索引速度 | 50KB 文档 < 3s（含 Embedding） |
| 批量索引 | 100 个文档（5MB）< 5min |

### 12.2 搜索性能

| 指标 | 目标 |
|------|------|
| 向量搜索 | < 100ms（10K chunks） |
| 倒排索引搜索 | < 50ms（1000 文件） |
| 融合排序 | < 50ms |
| AFD 读取（缓存命中） | < 1ms |
| AFD 读取（未命中） | < 10ms（50KB） |

### 12.3 存储效率

| 指标 | 目标 |
|------|------|
| AFD 压缩率 | 60-80% 空间节省 |
| 向量库体积优化 | 相比原方案减少 70-80% |

## 13. 云端知识库（SaaS 模式）

> 详细设计：`docs/specs/2026-03-30-cloud-knowledge-base-design.md`
> 实施计划：`docs/plans/2026-03-30-cloud-knowledge-base/plan.md`

### 13.1 目标

在保留 Electron 本地版的同时，支持云端多租户 SaaS 部署：
- 纯后台运行在 Linux 服务器上
- 通过 Web UI 管理知识库、上传文档
- 通过 MCP Streamable HTTP 供 AI Agent 查询

### 13.2 部署模式

| 模式 | 说明 |
|------|------|
| 本地模式 | Electron + 本地 MCP Streamable HTTP，存储为 LanceDB + SQLite + AFD（保持不变） |
| 云端模式 | Fastify HTTP Server + MCP Streamable HTTP + React Web UI |

### 13.3 云端存储

| 组件 | 本地 | 云端 |
|------|------|------|
| 向量索引 | LanceDB（文件型） | PostgreSQL + pgvector |
| 倒排索引 | SQLite + nodejieba | PostgreSQL + 应用层 BM25 + nodejieba |
| 文档归档 | AFD（Rust N-API） | S3 / MinIO |
| 索引元数据 | `.fs_index/index.json` | PostgreSQL `directories` / `files` 表 |
| 全局注册表 | `~/.agent_fs/registry.json` | PostgreSQL `tenants` / `projects` 表 |
| 知识线索 | `<project>/.fs_index/clues/*.json` | 暂未实现，当前 CloudAdapter 仅保留 `ClueAdapter` 占位 |

### 13.4 多租户

| 要求 | 说明 |
|------|------|
| 认证 | 自建用户系统（邮箱/密码，JWT），预留 OAuth / API Key |
| 租户隔离 | 所有表带 `tenant_id`，应用层强制过滤 |
| 配额 | 租户级存储配额（`storage_quota_bytes`） |

### 13.5 云端 MCP 工具

| Tool | 说明 |
|------|------|
| `list_indexes` | 列出当前租户所有已索引项目及统计 |
| `dir_tree` | 展示目录结构（基于 `directories` 表递归） |
| `glob_md` | 枚举指定项目/目录范围内的 Markdown 原文文件 |
| `read_md` | 读取指定文档的 Markdown 全文或指定行范围 |
| `grep_md` | 在 Markdown 原文里做精确文本搜索并返回上下文 |
| `search` | 多路召回搜索（语义 + 关键词），租户隔离 |
| `get_chunk` | 获取 chunk 详情（从 S3 读取归档） |
| `get_project_memory` | 获取项目 memory |
| `index_documents` | 🆕 从 URL 下载并触发索引 |

说明：当前云端模式尚未提供 `list_clues / browse_clue / read_clue_leaf / clue_*` 系列工具。

### 13.6 架构抽象

通过 `StorageAdapter` 接口解耦核心逻辑与存储后端：
- `VectorStoreAdapter` / `InvertedIndexAdapter` / `DocumentArchiveAdapter` / `MetadataAdapter` / `ClueAdapter`
- `LocalAdapter`：包装现有 LanceDB / SQLite / AFD / `.fs_index/clues`（Electron / 本地 MCP 用）
- `CloudAdapter`：实现 pgvector / PG BM25 / S3；当前 `ClueAdapter` 仅占位，尚未提供 SaaS Clue 能力
- 核心包（indexer / search）只依赖接口，不直接依赖具体后端

### 13.7 部署基础设施

| 组件 | 技术 |
|------|------|
| HTTP 框架 | Fastify |
| 任务队列 | pg-boss（基于 PostgreSQL） |
| 容器化 | Docker Compose（Server × N + Worker × N + PostgreSQL + MinIO） |
| Web UI | React + Vite + TailwindCSS |

### 13.8 安全要求

| 要求 | 说明 |
|------|------|
| SSRF 防护 | `index_documents` 工具从 URL 下载文档时，必须拦截私有/内网地址（`127.x`、`10.x`、`172.16-31.x`、`192.168.x`、`localhost` 等），协议仅允许 `http:` / `https:`，且对重定向目标同样校验 |
| 重定向限制 | URL 下载最多允许 3 次重定向，超过时中止请求 |
| 下载大小限制 | 单文件下载默认上限 100MB，超出时拒绝 |
| 下载超时 | 单次 HTTP 请求默认超时 30s |
| 租户隔离强制 | 所有存储查询（向量、倒排、元数据、S3）必须在服务层注入 `tenant_id` 过滤，不得依赖调用方传入 |
| 输入校验 | 上传文件须校验文件名非空；搜索请求须校验 `query` 非空 |

### 13.9 文档上传

| 要求 | 说明 |
|------|------|
| 多文件上传 | `POST /api/projects/:projectId/upload` 支持单次请求上传多个文件（multipart/form-data），每个文件独立排队索引 |
| 异步索引 | 上传立即返回 202，索引在 Worker 后台执行，通过 SSE `/api/projects/:projectId/indexing-events` 获取进度 |
| 文件状态流转 | `pending` → `indexing` → `indexed` / `failed`，失败记录 `error_message` 与 `retry_count` |

### 13.10 中文分词

云端倒排索引与本地版一致，使用 `nodejieba` 中文分词（应用层 BM25）。Docker 镜像构建时需安装 `python3 make g++` 以编译 `nodejieba` 原生模块。

### 13.11 向量维度动态适配

`chunks.content_vector` 列的维度在首次批量插入时由 `CloudVectorStoreAdapter.ensureVectorIndex()` 懒加载确定，HNSW 索引随之创建。切换 Embedding 模型导致维度变化时，需清空 `chunks` 表并重新索引。

---

*文档版本: 3.0*
*创建日期: 2025-02-02*
*更新日期: 2026-03-30*

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
超大块(>1.2K token) → SentenceSplitter 再切分
    ↓
每个 chunk 目标: 0.6-1.2K token，不切开段落和句子
    ↓
[LLM] 生成 chunk summary + 文档 summary
    ↓
[Embedding] 向量化 chunk 和 summary
    ↓
[存储]
    ├─ 向量库: chunk 向量 + summary 向量（不存文本）
    ├─ 倒排索引: searchableText 构建索引（持久化到 SQLite）
    └─ AFD 文件: markdown 压缩存储（.afd 格式）
    ↓
汇总生成目录 summary
```

### 2.3 索引内容

| 层级 | 索引内容 | 存储位置 |
|------|----------|----------|
| Chunk | chunk 向量、summary 向量、chunk 在 markdown 的行范围 | 向量库（LanceDB） |
| 倒排索引 | term → {chunk_id, locator, tf, positions} | SQLite（文件级 BLOB） |
| 文档内容 | markdown（语义化）、metadata | .afd 压缩文件 |
| 文档元数据 | 文件名、hash、fileId、chunkCount、summary | .fs_index/index.json |
| 目录元数据 | summary、文件列表、子目录列表、层级信息 | .fs_index/index.json |

### 2.4 搜索能力

| 需求 | 说明 |
|------|------|
| 多路召回 | 向量搜索(hybrid: content+summary 1:1) + 倒排索引关键词搜索 |
| 融合排序 | RRF（倒数排名融合） |
| 结果聚合 | RRF 结果按文档聚合后返回；同一文件只保留一个代表 chunk 进入 TopK，并记录该文件的命中 chunk 数 |
| 可选 Rerank | 支持 LLM Rerank |
| 查询类型 | 语义查询 + 精准关键词查询（可同时使用） |
| 查询范围 | 单/多个 Project 或子文件夹，**自动包含所有子文件夹** |
| 层级过滤 | 指定 Project 文件夹 → 搜索全部；指定子文件夹 → 仅搜索该子树 |
| 范围解析一致性 | scope 传入 Project 时，优先基于 `.fs_index/index.json` 递归解析真实 `dirId`；索引缺失时回退 registry |
| 结果元数据 | 搜索结果返回代表 chunk 的 `chunkId`，并可附带 `chunkHits` / `aggregatedChunkIds` 说明同文件聚合命中情况 |

### 2.5 增量更新

| 操作 | 说明 |
|------|------|
| 新增文档 | 检测新文件 → 执行完整索引流程 |
| 删除文档 | 检测已删除文件 → 从索引中移除 |
| 文档修改 | **检测文件变更 → 重建该文件索引** |
| 变更检测 | 文件 ≤200MB: MD5 哈希；文件 >200MB: 大小+修改时间 |
| 触发方式 | 手动触发（暂不支持自动检测） |
| 手动动作 | 增量更新 / 补全 Summary / 重新索引 |
| 补全 Summary | 基于 AFD（`content.md`/`summaries.json`）补齐缺失的 chunk/document/directory summary，并同步回写 summary 向量 |
| 补全并发策略 | 文件级并发遵循 `indexing.file_parallelism`；单文件内 chunk 批处理并发遵循 `summary.parallel_requests` |
| chunk 批次上限 | 单次 LLM 批量请求最多 4 个 chunk（文件处理完成后一次性写回 `summaries.json`） |
| 失败兜底策略 | chunk 批量 JSON 解析失败时，自动降级为逐 chunk 生成并重试 |
| 执行可观测性 | 维护弹窗实时展示进度（阶段/文件）与日志尾部，并刷新 summary 覆盖率 |

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
| MCP Server | 响应 AI Agent 查询 | stdio 模式，AI Agent 按需启动 |

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
| `documents/<原文件名>.afd` | 当前目录文件对应的压缩归档（ZIP，含 content.md、metadata.json、summaries.json） |

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
| 存储内容 | 仅存向量（content_vector, summary_vector, hybrid_vector） |
| 移除字段 | content、summary 文本字段（从 AFD 读取） |
| 新增字段 | file_id、chunk_line_start、chunk_line_end（用于定位 AFD） |
| 空间节省 | 向量库体积减少 70-80% |

## 5. MCP Tools

| Tool | 用途 |
|------|------|
| `list_indexes` | 列出所有已索引 **Project 文件夹**及其 summary（含子文件夹树） |
| `dir_tree` | 展示目录结构（文件/子目录的 summary） |
| `search` | 多路召回搜索（语义 + 精准关键词），支持多文件夹过滤 |
| `get_chunk` | 获取指定 chunk 详情及相邻 chunk（从 AFD 读取） |
| `get_project_memory` | 获取项目 memory 路径、project.md 内容和 markdown 文件列表 |

## 6. 用户界面

| 要求 | 说明 |
|------|------|
| 框架 | Electron + React |
| 风格 | 极简档案馆（类 Notion/Linear） |
| 核心功能 | 选择目录、启动索引、查看进度、管理配置、执行语义/精准搜索（支持范围选择）、查看项目概况 |
| 进度展示 | 当前文件、已完成/总数、索引更新时间 |
| 项目概况 | 展示文件数、已索引文件数、chunk 数、索引版本、Summary 覆盖率，并支持从概况面板触发增量更新 / 补全 Summary / 重新索引 |
| 布局约束 | 左侧项目面板与右侧搜索面板并排显示，列表卡片不得横向溢出或被搜索面板遮挡 |

## 7. 可配置项

| 配置项 | 说明 |
|--------|------|
| LLM | OpenAI 兼容 API（base_url / key / model） |
| Summary | mode / chunk_batch_token_budget / parallel_requests / timeout_ms / max_retries |
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

---

*文档版本: 2.1*
*创建日期: 2025-02-02*
*更新日期: 2026-02-08*

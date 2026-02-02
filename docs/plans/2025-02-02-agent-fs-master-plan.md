# Agent FS 实施总计划

> **For Claude:** 这是总计划文档。执行具体任务请使用对应的子计划文件。

**Goal:** 构建面向 AI Agent 的文件系统索引工具，支持多格式文档索引和 MCP 查询

**Architecture:** Monorepo 结构，分层架构（core → services → apps），插件式文档处理

**Tech Stack:** TypeScript, Node.js, LanceDB, nodejieba, Electron, React, MCP

---

## 计划结构

```
docs/plans/
├── 2025-02-02-agent-fs-design.md          # 设计文档
├── 2025-02-02-agent-fs-master-plan.md     # 本文件：总计划
│
├── 2025-02-02-plan-A-foundation.md        # A: 基础设施
├── 2025-02-02-plan-B1-config.md           # B1: 配置管理
├── 2025-02-02-plan-B2-chunker.md          # B2: 文本切分
├── 2025-02-02-plan-B3-bm25.md             # B3: BM25 搜索
├── 2025-02-02-plan-B4-plugin-md.md        # B4: Markdown 插件
├── 2025-02-02-plan-C1-embedding.md        # C1: Embedding 服务
├── 2025-02-02-plan-C2-summary.md          # C2: Summary 服务
├── 2025-02-02-plan-D-vector-store.md      # D: 向量存储
├── 2025-02-02-plan-E-fusion.md            # E: 多路融合
├── 2025-02-02-plan-F-indexer.md           # F: 索引流程
├── 2025-02-02-plan-G1-mcp-server.md       # G1: MCP Server
├── 2025-02-02-plan-G2-electron-app.md     # G2: Electron 应用
└── 2025-02-02-plan-P1-plugin-pdf.md       # P1: PDF 插件
```

---

## 依赖关系图

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Layer 0: 基础设施                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ [A] foundation                                                   │    │
│  │     Monorepo 搭建 + core/types 类型定义                           │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
       ┌────────────────┬───────────┴───────────┬────────────────┐
       ▼                ▼                       ▼                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Layer 1: 独立模块（可完全并行）                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │[B1]      │  │[B2]      │  │[B3]      │  │[B4]      │  │[P1]      │  │
│  │config    │  │chunker   │  │bm25      │  │plugin-md │  │plugin-pdf│  │
│  │配置管理   │  │文本切分   │  │BM25搜索  │  │MD插件    │  │PDF插件   │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Layer 2: LLM 服务（可并行）                                             │
│  ┌─────────────────────────┐  ┌─────────────────────────┐              │
│  │ [C1] embedding          │  │ [C2] summary            │              │
│  │ Embedding 服务           │  │ Summary 生成            │              │
│  └─────────────────────────┘  └─────────────────────────┘              │
└─────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Layer 3: 存储层                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ [D] vector-store                                                 │    │
│  │     LanceDB 封装，集中存储管理                                     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Layer 4: 融合层                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ [E] fusion                                                       │    │
│  │     RRF 多路召回融合                                              │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Layer 5: 索引流程                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ [F] indexer                                                      │    │
│  │     整合所有组件，实现完整索引流程                                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                    │
       ┌────────────┴────────────┐
       ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Layer 6: 应用层（可并行）                                               │
│  ┌─────────────────────────┐  ┌─────────────────────────┐              │
│  │ [G1] mcp-server         │  │ [G2] electron-app       │              │
│  │ MCP Server              │  │ 桌面客户端               │              │
│  └─────────────────────────┘  └─────────────────────────┘              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 子计划清单

### [A] foundation - 基础设施

| 属性 | 值 |
|------|-----|
| **文件** | `2025-02-02-plan-A-foundation.md` |
| **依赖** | 无 |
| **并行组** | Layer 0 |
| **预计任务数** | 15 |

**范围：**
- Monorepo 初始化（pnpm workspace）
- TypeScript 配置（base tsconfig）
- ESLint + Prettier 配置
- `packages/core/types` - 所有接口定义

**成功标准：**
- [ ] `pnpm install` 成功
- [ ] `pnpm build` 成功（空项目）
- [ ] `packages/core` 导出所有类型定义
- [ ] 类型定义覆盖：DocumentPlugin, Chunk, SearchResult, Config 等

**输出接口：**
```typescript
// @agent-fs/core
export type { DocumentPlugin, PositionMapping } from './types/plugin';
export type { Chunk, ChunkMetadata } from './types/chunk';
export type { SearchResult, SearchOptions } from './types/search';
export type { Config, LLMConfig, EmbeddingConfig } from './types/config';
export type { IndexMetadata, FileMetadata } from './types/index';
```

---

### [B1] config - 配置管理

| 属性 | 值 |
|------|-----|
| **文件** | `2025-02-02-plan-B1-config.md` |
| **依赖** | [A] foundation |
| **并行组** | Layer 1 |
| **预计任务数** | 10 |

**范围：**
- `packages/core/config` - 配置加载与管理
- YAML 解析（js-yaml）
- 环境变量 / .env 支持
- 配置验证（zod）

**成功标准：**
- [ ] 能读取 `~/.agent_fs/config.yaml`
- [ ] 支持 `${ENV_VAR}` 变量替换
- [ ] 支持 `.env` 文件加载
- [ ] 配置验证通过/失败有明确错误信息
- [ ] 单元测试覆盖率 > 80%

**输出接口：**
```typescript
// @agent-fs/core
export { loadConfig, validateConfig } from './config';
export type { ResolvedConfig } from './config';
```

---

### [B2] chunker - 文本切分

| 属性 | 值 |
|------|-----|
| **文件** | `2025-02-02-plan-B2-chunker.md` |
| **依赖** | [A] foundation |
| **并行组** | Layer 1 |
| **预计任务数** | 12 |

**范围：**
- `packages/core/chunker` - Markdown 文本切分
- AST 解析（remark）
- 按标题层级切分
- 超大段落句子切分
- Token 计数（tiktoken 或兼容）
- 10-15% overlap 支持

**成功标准：**
- [ ] 能按 Markdown 标题层级切分
- [ ] 超过 max_tokens 自动再切分
- [ ] chunk 大小在 min_tokens ~ max_tokens 范围内
- [ ] 支持 overlap
- [ ] 输出包含 locator（行号范围）
- [ ] 单元测试覆盖率 > 80%

**输出接口：**
```typescript
// @agent-fs/core
export { MarkdownChunker } from './chunker';
export type { ChunkerOptions, ChunkResult } from './chunker';
```

---

### [B3] bm25 - BM25 搜索

| 属性 | 值 |
|------|-----|
| **文件** | `2025-02-02-plan-B3-bm25.md` |
| **依赖** | [A] foundation |
| **并行组** | Layer 1 |
| **预计任务数** | 15 |

**范围：**
- `packages/search/bm25` - 中文 BM25 实现
- nodejieba 中文分词
- BM25 算法实现
- 索引持久化（JSON）
- 软删除 + tombstone 机制
- 按 scope（dir_id/file_path）过滤

**成功标准：**
- [ ] 中文分词正确
- [ ] BM25 搜索结果按相关度排序
- [ ] 支持增量添加文档
- [ ] 支持软删除（tombstone）
- [ ] 支持 scope 过滤
- [ ] 索引可持久化和加载
- [ ] 单元测试覆盖率 > 80%

**输出接口：**
```typescript
// @agent-fs/search
export { BM25Index } from './bm25';
export type { BM25Document, BM25SearchOptions, BM25Result } from './bm25';
```

---

### [B4] plugin-md - Markdown 插件

| 属性 | 值 |
|------|-----|
| **文件** | `2025-02-02-plan-B4-plugin-md.md` |
| **依赖** | [A] foundation |
| **并行组** | Layer 1 |
| **预计任务数** | 8 |

**范围：**
- `packages/plugins/plugin-markdown` - Markdown 插件
- 实现 DocumentPlugin 接口
- 读取 .md 文件
- 生成 PositionMapping（行号）

**成功标准：**
- [ ] 正确实现 DocumentPlugin 接口
- [ ] toMarkdown() 返回原内容 + mapping
- [ ] parseLocator() 正确解析行号
- [ ] 单元测试覆盖率 > 80%

**输出接口：**
```typescript
// @agent-fs/plugin-markdown
export { MarkdownPlugin } from './index';
```

---

### [P1] plugin-pdf - PDF 插件

| 属性 | 值 |
|------|-----|
| **文件** | `2025-02-02-plan-P1-plugin-pdf.md` |
| **依赖** | [A] foundation |
| **并行组** | Layer 1 |
| **预计任务数** | 12 |

**范围：**
- `packages/plugins/plugin-pdf` - PDF 插件
- 实现 DocumentPlugin 接口
- PDF 解析（pdf-parse 或类似库）
- 页码 mapping 生成

**成功标准：**
- [ ] 正确实现 DocumentPlugin 接口
- [ ] 能提取 PDF 文本内容
- [ ] 生成正确的页码 mapping
- [ ] 单元测试覆盖率 > 80%

**输出接口：**
```typescript
// @agent-fs/plugin-pdf
export { PDFPlugin } from './index';
```

---

### [C1] embedding - Embedding 服务

| 属性 | 值 |
|------|-----|
| **文件** | `2025-02-02-plan-C1-embedding.md` |
| **依赖** | [A] foundation, [B1] config |
| **并行组** | Layer 2 |
| **预计任务数** | 15 |

**范围：**
- `packages/llm/embedding` - Embedding 服务
- 本地模型支持（transformers.js 或 onnxruntime）
- OpenAI 兼容 API 支持
- 缓存机制（model + text_hash）
- 批量处理

**成功标准：**
- [ ] 本地模型可加载并生成 embedding
- [ ] API 模式可调用 OpenAI 兼容接口
- [ ] 缓存命中时不重复计算
- [ ] 支持批量 embedding
- [ ] 单元测试覆盖率 > 80%

**输出接口：**
```typescript
// @agent-fs/llm
export { EmbeddingService } from './embedding';
export type { EmbeddingOptions, EmbeddingResult } from './embedding';
```

---

### [C2] summary - Summary 服务

| 属性 | 值 |
|------|-----|
| **文件** | `2025-02-02-plan-C2-summary.md` |
| **依赖** | [A] foundation, [B1] config |
| **并行组** | Layer 2 |
| **预计任务数** | 12 |

**范围：**
- `packages/llm/summary` - Summary 生成服务
- OpenAI 兼容 API 调用
- 批量处理
- 重试机制（指数退避）
- 降级策略（失败时用首段）
- 缓存机制

**成功标准：**
- [ ] 能调用 LLM 生成 chunk summary
- [ ] 能生成文档 summary
- [ ] 能生成目录 summary
- [ ] 支持批量处理
- [ ] 失败时降级到首段摘要
- [ ] 单元测试覆盖率 > 80%

**输出接口：**
```typescript
// @agent-fs/llm
export { SummaryService } from './summary';
export type { SummaryOptions, SummaryResult } from './summary';
```

---

### [D] vector-store - 向量存储

| 属性 | 值 |
|------|-----|
| **文件** | `2025-02-02-plan-D-vector-store.md` |
| **依赖** | [A] foundation, [C1] embedding |
| **并行组** | Layer 3 |
| **预计任务数** | 15 |

**范围：**
- `packages/search/vector-store` - LanceDB 封装
- 集中存储管理（~/.agent_fs/storage/vectors）
- 向量 CRUD 操作
- scope 过滤查询
- 软删除支持
- 压缩/重建机制

**成功标准：**
- [ ] 能存储向量到 LanceDB
- [ ] 能按 scope（dir_id/file_path）过滤查询
- [ ] 支持软删除（deleted_at）
- [ ] 支持批量操作
- [ ] 单元测试覆盖率 > 80%

**输出接口：**
```typescript
// @agent-fs/search
export { VectorStore } from './vector-store';
export type { VectorDocument, VectorSearchOptions, VectorSearchResult } from './vector-store';
```

---

### [E] fusion - 多路融合

| 属性 | 值 |
|------|-----|
| **文件** | `2025-02-02-plan-E-fusion.md` |
| **依赖** | [B3] bm25, [D] vector-store |
| **并行组** | Layer 4 |
| **预计任务数** | 10 |

**范围：**
- `packages/search/fusion` - 多路召回融合
- RRF（Reciprocal Rank Fusion）算法
- 支持多路向量召回（chunk + summary）
- 与 BM25 结果融合
- 可选 LLM Rerank

**成功标准：**
- [ ] RRF 算法正确实现
- [ ] 能融合向量搜索和 BM25 结果
- [ ] 融合结果按分数排序
- [ ] 单元测试覆盖率 > 80%

**输出接口：**
```typescript
// @agent-fs/search
export { SearchFusion } from './fusion';
export type { FusionOptions, FusionResult } from './fusion';
```

---

### [F] indexer - 索引流程

| 属性 | 值 |
|------|-----|
| **文件** | `2025-02-02-plan-F-indexer.md` |
| **依赖** | [B1-B4], [C1-C2], [D], [E], [P1] |
| **并行组** | Layer 5 |
| **预计任务数** | 20 |

**范围：**
- `packages/indexer` - 索引流程整合
- 目录扫描
- 插件调度
- 流水线处理（convert → split → summary → embed → write）
- 进度回调
- 断点恢复
- registry.json 管理
- .fs_index 目录管理

**成功标准：**
- [ ] 能扫描目录发现支持的文件
- [ ] 能调用插件转换文档
- [ ] 完整流水线运行成功
- [ ] 索引结果写入 .fs_index 和集中存储
- [ ] registry.json 正确更新
- [ ] 支持进度回调
- [ ] 集成测试通过

**输出接口：**
```typescript
// @agent-fs/indexer
export { Indexer } from './indexer';
export type { IndexerOptions, IndexProgress, IndexResult } from './indexer';
```

---

### [G1] mcp-server - MCP Server

| 属性 | 值 |
|------|-----|
| **文件** | `2025-02-02-plan-G1-mcp-server.md` |
| **依赖** | [F] indexer |
| **并行组** | Layer 6 |
| **预计任务数** | 15 |

**范围：**
- `packages/mcp-server` - MCP Server 实现
- stdio 模式
- 实现 4 个 tools：list_indexes, dir_tree, search, get_chunk
- 错误处理

**成功标准：**
- [ ] MCP Server 可启动
- [ ] list_indexes 返回所有索引目录
- [ ] dir_tree 返回目录结构
- [ ] search 返回搜索结果
- [ ] get_chunk 返回 chunk 详情
- [ ] 集成测试通过

**输出接口：**
```bash
# 启动命令
npx @agent-fs/mcp-server
```

---

### [G2] electron-app - Electron 应用

| 属性 | 值 |
|------|-----|
| **文件** | `2025-02-02-plan-G2-electron-app.md` |
| **依赖** | [F] indexer |
| **并行组** | Layer 6 |
| **预计任务数** | 25 |

**范围：**
- `packages/electron-app` - Electron 桌面应用
- React 前端
- 极简档案馆风格 UI
- 目录选择与索引管理
- 进度展示
- 配置管理
- 无效索引清理

**成功标准：**
- [ ] 应用可启动
- [ ] 能选择目录并开始索引
- [ ] 进度条正确显示
- [ ] 能查看已索引目录列表
- [ ] 能编辑配置
- [ ] 能清理无效索引
- [ ] 打包成可执行文件

**输出接口：**
```bash
# 开发模式
pnpm --filter electron-app dev

# 打包
pnpm --filter electron-app build
```

---

## 执行顺序建议

```
Week 1:
  [A] foundation (必须先完成)

Week 2 (并行):
  [B1] config    ──┐
  [B2] chunker   ──┼── 可同时进行
  [B3] bm25      ──┤
  [B4] plugin-md ──┤
  [P1] plugin-pdf ─┘

Week 3 (并行):
  [C1] embedding ──┬── 可同时进行
  [C2] summary   ──┘

Week 4:
  [D] vector-store

Week 5:
  [E] fusion

Week 6:
  [F] indexer

Week 7 (并行):
  [G1] mcp-server  ──┬── 可同时进行
  [G2] electron-app ─┘
```

---

## 如何开始子计划

对于每个子计划，使用以下命令启动：

```
执行 Plan [X]：请阅读 docs/plans/2025-02-02-plan-X-xxx.md 并按步骤执行
```

例如：
- `执行 Plan A：请阅读 docs/plans/2025-02-02-plan-A-foundation.md 并按步骤执行`
- `执行 Plan B1：请阅读 docs/plans/2025-02-02-plan-B1-config.md 并按步骤执行`

---

## 验收检查点

| 检查点 | 完成条件 | 验证方式 |
|--------|---------|---------|
| **CP1** | Layer 0-1 完成 | `pnpm build` 成功，所有 Layer 1 测试通过 |
| **CP2** | Layer 2 完成 | embedding 和 summary 服务可用 |
| **CP3** | Layer 3-4 完成 | 向量存储和搜索融合可用 |
| **CP4** | Layer 5 完成 | 完整索引流程可运行 |
| **CP5** | Layer 6 完成 | MCP Server 和 Electron 应用可用 |
| **Final** | 全部完成 | 端到端测试：选择目录 → 索引 → MCP 查询成功 |

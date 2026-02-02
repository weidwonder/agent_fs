# Agent FS - AI Agent 文件系统索引工具设计文档

## 概述

Agent FS 是一个面向 AI Agent 的文件系统索引工具，支持对文件夹中的文档进行智能索引，并通过 MCP 提供多路召回搜索能力。

### 核心特性

- 支持 PDF / DOCX / XLSX / Markdown 等文档格式（插件式扩展）
- 文档自动转换为 Markdown，按章节/段落智能切分
- 自动生成 chunk summary 和文档 summary
- 多路向量召回 + BM25 关键词搜索 + RRF 融合
- MCP Server 支持 AI Agent 查询
- 跨平台支持（Windows 必须，macOS/Linux 尽量）

---

## 技术选型

| 组件 | 选型 | 说明 |
|------|------|------|
| **主框架** | TypeScript | Node.js 运行时 |
| **文档处理** | 插件系统 | TypeScript 模块，内部可调用外部程序 |
| **插件通信** | 命名管道 IPC | 插件内部与外部程序通信（如 C#） |
| **向量存储** | LanceDB | 文件型，存在 `.fs_index` 目录 |
| **全文搜索** | 自实现 BM25 | nodejieba 中文分词 |
| **Embedding** | 混合方案 | 本地模型 + OpenAI 兼容 API |
| **LLM Summary** | OpenAI 兼容 API | 可配置 base_url/key/model |
| **Rerank** | RRF 融合 | 多路向量召回 + 可选 LLM Rerank |
| **桌面应用** | Electron + React | 极简档案馆风格（类 Notion/Linear） |
| **MCP Server** | stdio 模式 | AI Agent 按需启动 |
| **配置格式** | YAML | 支持注释，用户友好 |

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                用户主机                                      │
│                                                             │
│  ┌─────────────────────┐      ┌─────────────────────────┐  │
│  │  Electron 客户端     │      │     MCP Server          │  │
│  │  - 创建/管理索引     │      │     - stdio 模式        │  │
│  │  - 查看进度/状态     │      │     - AI Agent 按需启动  │  │
│  │  - 配置管理          │      │     - 支持多目录查询     │  │
│  └──────────┬──────────┘      └────────────┬────────────┘  │
│             │                              │               │
│             │    ┌──────────────────┐      │               │
│             └───►│  全局注册表       │◄─────┘               │
│                  │ ~/.agent_fs/     │                      │
│                  │  - config.yaml   │                      │
│                  │  - registry.json │                      │
│                  └──────────────────┘                      │
│                           │                                │
│        ┌──────────────────┼──────────────────┐            │
│        ▼                  ▼                  ▼            │
│  ┌──────────┐      ┌──────────┐       ┌──────────┐       │
│  │ 项目A    │      │ 项目B    │       │ 项目C    │       │
│  │ .fs_index│      │ .fs_index│       │ .fs_index│       │
│  └──────────┘      └──────────┘       └──────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### 程序架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron App (UI)                        │
│                 React + 极简档案馆风格                        │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                    Core (TypeScript)                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │ 索引管理器   │ │ 搜索引擎    │ │ 配置管理    │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │ 插件管理器   │ │ 向量服务    │ │ MCP 服务    │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
└─────────────────────┬───────────────────────────────────────┘
                      │ TypeScript 接口调用
┌─────────────────────▼───────────────────────────────────────┐
│                 插件层 (TypeScript 模块)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ PDF 插件  │ │ DOCX 插件│ │ XLSX 插件│ │ MD 插件  │ ...   │
│  │ (调用C#) │ │ (调用C#) │ │ (调用C#) │ │ (纯TS)  │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                    存储层 (.fs_index)                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │ LanceDB    │ │ BM25 索引   │ │ 元数据 JSON │           │
│  │ (向量)     │ │ (中文分词)  │ │ (summary等) │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

---

## 应用流程

### 首次索引流程

```
用户操作                        系统行为
────────────────────────────────────────────────────────────
1. 启动应用
   └─> 选择文件夹路径           检查该目录是否已有 .fs_index

2. 点击"开始索引"               扫描目录，发现支持的文件
                                (pdf/docx/xlsx/md...)

3. 显示文件列表                 按文件类型分发给对应插件
   用户确认要索引的文件
                                对每个文件：
                                a) 插件将文件转换为 Markdown
                                   (保留位置映射表)
                                b) MarkdownNodeParser 按结构切分
                                   超大块用 SentenceSplitter 再切
                                   (0.6-1.2K token)
                                c) 调用 LLM 生成 summary
                                   (chunk summary + 文档 summary)
                                d) 调用 Embedding 模型向量化
                                e) 存入 LanceDB + BM25 索引

4. 进度条显示处理进度            扫描子目录的 .fs_index/index.json
   - 当前文件名                  (如有子目录且已索引)
   - 已完成/总数

5. 索引完成                     汇总所有文件+子目录 summary
   显示统计信息                  生成本目录的 summary
                                写入 .fs_index/index.json
```

### 增量更新流程

```
用户操作                        系统行为
────────────────────────────────────────────────────────────
1. 点击"检查更新"               比对当前目录文件与 .fs_index 记录

2. 显示变更列表                  检测到：
   - 新增文件: 3                 - 新文件（不在索引中）
   - 删除文件: 1                 - 已删除文件（索引中有但文件不存在）

3. 确认更新                     - 新增文件：走完整索引流程
                                - 删除文件：从 LanceDB/BM25 中移除
                                - 重新生成目录 summary

4. 更新完成                      更新 .fs_index/index.json
                                 记录最后更新时间
```

### 搜索流程 (MCP)

```
AI Agent 调用                   系统行为
────────────────────────────────────────────────────────────
1. MCP 请求                     解析查询
   query: "项目预算相关内容"
                                多路召回：
                                a) LanceDB 向量搜索 (chunk)
                                b) LanceDB 向量搜索 (summary)
                                c) BM25 关键词搜索 (中文分词)

                                RRF 融合排序

                                可选：LLM Rerank

2. 返回结果                     返回 top-k 结果，包含：
   - 相关 chunk 列表             - chunk 内容
   - 来源文件                    - 文件路径
   - 原文位置                    - 原文位置映射
   - 相关度分数                  - 相关度分数
```

---

## 数据结构设计

### 全局注册表 `~/.agent_fs/registry.json`

```json
{
  "indexed_directories": [
    {
      "path": "D:\\Projects\\ProjectA",
      "alias": "营销项目",
      "summary": "2024年Q3营销项目文档库，包含预算表、执行方案、竞品分析报告等",
      "last_updated": "2025-02-02T10:30:00Z",
      "file_count": 42,
      "chunk_count": 1280
    }
  ]
}
```

### `.fs_index` 目录结构

```
ProjectA/
├── 文档1.pdf
├── 文档2.docx
├── 数据表.xlsx
├── 说明.md
├── 子目录/
│   └── .fs_index/
└── .fs_index/
    ├── index.json          ← 主索引文件（元数据）
    ├── vectors/            ← LanceDB 向量存储
    │   └── chunks.lance
    ├── bm25/               ← BM25 全文索引
    │   ├── index.json
    │   └── terms.json
    ├── documents/          ← 文档处理结果
    │   ├── 文档1.pdf/
    │   │   ├── content.md
    │   │   ├── mapping.json
    │   │   ├── chunks.json
    │   │   └── summary.json
    │   └── ...
    └── cache/
        └── embeddings/
```

### `index.json` 结构

```json
{
  "version": "1.0",
  "created_at": "2025-02-02T10:00:00Z",
  "updated_at": "2025-02-02T10:30:00Z",

  "directory_summary": "2024年Q3营销项目文档库...",

  "stats": {
    "file_count": 4,
    "chunk_count": 128,
    "total_tokens": 85000
  },

  "files": [
    {
      "name": "文档1.pdf",
      "type": "pdf",
      "size": 1024000,
      "hash": "sha256:abc123...",
      "indexed_at": "2025-02-02T10:05:00Z",
      "chunk_count": 32,
      "summary": "Q3营销预算明细表..."
    }
  ],

  "subdirectories": [
    {
      "name": "子目录",
      "has_index": true,
      "summary": "子目录的 summary...",
      "last_updated": "2025-02-01T15:00:00Z"
    }
  ],

  "unsupported_files": [
    "设计图.psd",
    "视频.mp4"
  ]
}
```

### `chunks.json` 结构

```json
{
  "document": "文档1.pdf",
  "chunks": [
    {
      "id": "chunk_001",
      "content": "第一章 项目概述\n\n本项目旨在...",
      "summary": "介绍项目的背景和目标",
      "token_count": 850,
      "locator": "page:1-2"
    }
  ]
}
```

---

## 插件系统设计

### 插件接口

```typescript
interface DocumentPlugin {
  name: string;
  supportedExtensions: string[];

  toMarkdown(filePath: string): Promise<{
    markdown: string;
    mapping: PositionMapping[];
  }>;

  parseLocator?(locator: string): {
    displayText: string;
    jumpInfo?: any;
  };

  init?(): Promise<void>;
  dispose?(): Promise<void>;
}

interface PositionMapping {
  markdownRange: {
    startLine: number;
    endLine: number;
  };
  originalLocator: string;  // 插件自定义格式
}
```

### 各插件 locator 格式示例

| 插件 | originalLocator 格式 | 示例 |
|------|---------------------|------|
| PDF | `page:{n}` | `"page:5"` |
| DOCX | `heading:{path}` | `"heading:第一章/1.1概述"` |
| XLSX | `sheet:{name}/range:{range}` | `"sheet:销售数据/range:A1:D20"` |
| Markdown | `line:{n}` | `"line:42"` |

### 插件目录结构

```
plugins/
├── plugin-pdf/
│   ├── package.json
│   └── index.ts
├── plugin-docx/
│   └── ...
├── plugin-xlsx/
│   └── ...
└── plugin-markdown/
    └── ...
```

---

## MCP Tools 设计

### Tool 1: `list_indexes`

列出所有已注册的索引目录。

```typescript
interface ListIndexesInput {}

interface ListIndexesOutput {
  indexes: Array<{
    path: string;
    alias: string;
    summary: string;
    last_updated: string;
    stats: {
      file_count: number;
      chunk_count: number;
    };
  }>;
}
```

### Tool 2: `dir_tree`

展示指定目录的结构树。

```typescript
interface DirTreeInput {
  scope: string;
  depth?: number;
}

interface DirTreeOutput {
  path: string;
  summary: string;

  files: Array<{
    path: string;
    summary: string;
  }>;

  subdirectories: Array<{
    path: string;
    has_index: boolean;
    summary: string | null;
    children?: DirTreeOutput;
  }>;

  unsupported_files: string[];
}
```

### Tool 3: `search`

多路召回搜索，支持语义查询和精准关键词查询。

```typescript
interface SearchInput {
  query: string;              // 语义查询
  keyword?: string;           // 精准关键词查询（可选）
  scope: string | string[];
  top_k?: number;
  filters?: {
    file_types?: string[];
    file_names?: string[];
  };
}

interface SearchOutput {
  results: Array<{
    chunk_id: string;
    score: number;
    content: string;
    summary: string;
    source: {
      file_path: string;
      locator: string;
    };
  }>;

  meta: {
    total_searched: number;
    fusion_method: string;
    elapsed_ms: number;
  };
}
```

### Tool 4: `get_chunk`

获取指定 chunk 的完整信息。

```typescript
interface GetChunkInput {
  chunk_id: string;
  include_neighbors?: boolean;
  neighbor_count?: number;
}

interface GetChunkOutput {
  chunk: {
    id: string;
    content: string;
    summary: string;
    token_count: number;
    source: {
      file_path: string;
      locator: string;
    };
  };

  neighbors?: {
    before: Array<{ id: string; summary: string; }>;
    after: Array<{ id: string; summary: string; }>;
  };
}
```

---

## 配置文件设计

### `~/.agent_fs/config.yaml`

```yaml
# LLM 配置（用于 Summary 生成）
llm:
  provider: "openai-compatible"
  base_url: "https://api.openai.com/v1"
  api_key: "${OPENAI_API_KEY}"
  model: "gpt-4o-mini"

# Embedding 配置
embedding:
  default: "local"

  local:
    model: "bge-small-zh-v1.5"
    device: "cpu"

  api:
    provider: "openai-compatible"
    base_url: "https://api.openai.com/v1"
    api_key: "${OPENAI_API_KEY}"
    model: "text-embedding-3-small"

# Rerank 配置（可选）
rerank:
  enabled: false
  provider: "llm"

# 索引配置
indexing:
  chunk_size:
    min_tokens: 600
    max_tokens: 1200

# 搜索配置
search:
  default_top_k: 10
  fusion:
    method: "rrf"

# 插件配置（可选，覆盖插件默认参数）
plugins:
  pdf:
    extra_param: "as_example"
```

---

## 模块划分（Monorepo）

```
agent_fs/
├── packages/
│   ├── core/                    ← 核心库
│   │   ├── config/
│   │   ├── plugin-manager/
│   │   ├── chunker/
│   │   └── types/
│   │
│   ├── indexer/                 ← 索引服务
│   │   ├── scanner/
│   │   ├── processor/
│   │   └── storage/
│   │
│   ├── search/                  ← 搜索服务
│   │   ├── vector-store/
│   │   ├── bm25/
│   │   ├── fusion/
│   │   └── rerank/
│   │
│   ├── llm/                     ← LLM 服务
│   │   ├── embedding/
│   │   └── summary/
│   │
│   ├── mcp-server/              ← MCP Server
│   │
│   ├── electron-app/            ← Electron 客户端
│   │   ├── main/
│   │   └── renderer/
│   │
│   └── plugins/                 ← 文档插件
│       ├── plugin-pdf/
│       ├── plugin-docx/
│       ├── plugin-xlsx/
│       └── plugin-markdown/
│
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## 并行开发计划

### 第一阶段（可完全并行）

- `core/types` - 定义所有接口
- `core/chunker` - 文本切分
- `search/bm25` - 中文 BM25
- `llm/embedding` - Embedding 服务
- `llm/summary` - Summary 服务
- `plugin-markdown` - 最简单插件（用于测试）
- `plugin-pdf/docx/xlsx` - 各文档插件

### 第二阶段（整合）

- `search/vector-store` - LanceDB 整合
- `search/fusion` - 多路召回融合
- `indexer` - 索引流程整合

### 第三阶段（应用层）

- `mcp-server` - MCP 接口
- `electron-app` - 桌面应用

---

## 附录

### 不支持文件类型处理

只记录文件名，不做任何索引处理。AI Agent 可通过 `dir_tree` 知道这些文件存在。

### 中文搜索方案

由于 LanceDB 的 BM25 不原生支持中文，采用以下方案：
- 向量搜索为主（使用支持中文的 embedding 模型）
- 自实现 BM25（nodejieba 分词）
- RRF 融合多路召回结果

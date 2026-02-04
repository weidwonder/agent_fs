# Agent FS 架构文档

> 面向 AI Agent 的文件系统智能索引工具

## 1. 系统概述

Agent FS 是一个让 AI Agent 能够检索用户本地文档的工具。核心流程：

```
用户选择文件夹 → 自动处理文档 → 生成索引 → AI Agent 通过 MCP 查询
```

### 1.1 设计目标

- **本地优先**：数据存储在本地，保护隐私
- **多格式支持**：PDF / DOCX / DOC / XLSX / XLS / Markdown
- **混合搜索**：向量语义搜索 + BM25 关键词搜索
- **插件化**：文档处理插件独立开发和扩展

## 2. 技术栈

| 组件 | 技术 | 版本 |
|------|------|------|
| 主框架 | TypeScript / Node.js | Node 18+ |
| 包管理 | pnpm workspace | 8+ |
| 向量存储 | LanceDB | 0.23+ |
| 全文搜索 | 自实现 BM25 + nodejieba | - |
| Embedding | @xenova/transformers / OpenAI API | 2.17+ |
| 文档转换 | .NET 8 + NPOI (DOCX/Excel) | - |
| 测试框架 | Vitest | 4.0+ |
| 配置格式 | YAML + Zod 校验 | - |

## 3. 系统架构

### 3.1 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                    应用层 (Applications)                     │
│  ┌──────────────────────┐  ┌──────────────────────────────┐ │
│  │  MCP Server (G1)     │  │  Electron App (G2)           │ │
│  │  - AI Agent 查询接口 │  │  - 索引管理 UI               │ │
│  │  - stdio 模式        │  │  - 配置界面                  │ │
│  └──────────────────────┘  └──────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                    索引层 (Indexing)                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  @agent-fs/indexer                                   │   │
│  │  - Indexer: 主索引器                                 │   │
│  │  - IndexPipeline: 索引流水线                         │   │
│  │  - PluginManager: 插件管理                           │   │
│  └──────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                    服务层 (Services)                         │
│  ┌────────────────────────┐  ┌───────────────────────────┐  │
│  │  @agent-fs/search      │  │  @agent-fs/llm            │  │
│  │  - BM25Index           │  │  - EmbeddingService       │  │
│  │  - VectorStore         │  │  - SummaryService         │  │
│  │  - SearchFusion (RRF)  │  │  - 本地/API 双模式        │  │
│  └────────────────────────┘  └───────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    插件层 (Plugins)                          │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐  │
│  │ plugin-md  │ │ plugin-pdf │ │ plugin-docx│ │plugin-xl │  │
│  │ 纯 TS      │ │ pdfjs-dist │ │ .NET+NPOI  │ │.NET+NPOI │  │
│  └────────────┘ └────────────┘ └────────────┘ └──────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    核心层 (Core)                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  @agent-fs/core                                      │   │
│  │  - 类型定义 (Chunk, Config, Plugin, Storage)         │   │
│  │  - 配置加载 (YAML + 环境变量)                        │   │
│  │  - 文本切分 (MarkdownChunker, SentenceSplitter)      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 包依赖关系

```
@agent-fs/indexer
    ├── @agent-fs/core
    ├── @agent-fs/search
    │       └── @agent-fs/core
    ├── @agent-fs/llm
    │       └── @agent-fs/core
    └── plugins/*
            └── @agent-fs/core
```

## 4. 核心模块

### 4.1 @agent-fs/core

核心类型定义和通用工具。

**主要导出：**

| 模块 | 说明 |
|------|------|
| `types/plugin.ts` | DocumentPlugin 接口定义 |
| `types/chunk.ts` | Chunk 和 ChunkMetadata 类型 |
| `types/config.ts` | Config、LLMConfig、EmbeddingConfig 等 |
| `types/storage.ts` | VectorDocument、BM25Document (snake_case) |
| `config/loader.ts` | 配置文件加载器 |
| `chunker/markdown-chunker.ts` | Markdown 结构化切分 |
| `chunker/sentence-splitter.ts` | 句子级切分 |

### 4.2 @agent-fs/search

搜索引擎实现。

**组件：**

| 组件 | 说明 |
|------|------|
| `BM25Index` | 自实现 BM25 算法，nodejieba 中文分词 |
| `VectorStore` | LanceDB 向量存储封装 |
| `SearchFusion` | RRF 多路融合搜索 |

**BM25 特点：**
- 自实现算法，不依赖 LanceDB FTS
- nodejieba 中文分词
- 支持持久化到磁盘

### 4.3 @agent-fs/llm

LLM 服务。

**组件：**

| 组件 | 说明 |
|------|------|
| `EmbeddingService` | 向量化服务（本地模型 / API） |
| `SummaryService` | Summary 生成（OpenAI 兼容 API） |

**Embedding 双模式：**
- **本地模式**：@xenova/transformers，无需联网
- **API 模式**：OpenAI 兼容接口

### 4.4 @agent-fs/indexer

索引流程整合。

**类和函数：**

| 类/函数 | 说明 |
|---------|------|
| `Indexer` | 主索引器，提供 `index()` 方法 |
| `IndexPipeline` | 完整索引流水线 |
| `PluginManager` | 插件注册和查找 |
| `scanDirectory()` | 目录扫描 |

### 4.5 文档插件

| 插件 | 实现方式 | 支持格式 |
|------|----------|----------|
| plugin-markdown | 纯 TypeScript | .md |
| plugin-pdf | TS + pdfjs-dist | .pdf |
| plugin-docx | TS + .NET 8 (stdio) | .docx, .doc |
| plugin-excel | TS + .NET 8 (stdio) | .xlsx, .xls |

**插件接口：**

```typescript
interface DocumentPlugin {
  name: string;
  version: string;
  supportedExtensions: string[];

  convert(filePath: string, options?: any): Promise<DocumentConversionResult>;
  parseLocator(locatorStr: string): LocatorInfo;
}
```

## 5. 数据流

### 5.1 索引流程

```
用户选择文件夹
       │
       ▼
┌──────────────────┐
│  scanDirectory() │  发现支持的文件
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  PluginManager   │  按格式分发给对应插件
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Plugin.convert()│  转 Markdown + 位置映射
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ MarkdownChunker  │  按结构切分 (0.6-1.2K token)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ EmbeddingService │  向量化
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ SummaryService   │  生成 summary (可选)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ VectorStore      │  存入 LanceDB
│ BM25Index        │  构建 BM25 索引
└──────────────────┘
```

### 5.2 搜索流程

```
用户查询
    │
    ▼
┌──────────────────┐
│ EmbeddingService │  查询向量化
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  SearchFusion    │
│  ┌─────────────┐ │
│  │VectorStore  │─┼─→ 向量搜索 top-k
│  │BM25Index    │─┼─→ BM25 搜索 top-k
│  │RRF Fusion   │─┼─→ 倒数排名融合
│  └─────────────┘ │
└────────┬─────────┘
         │
         ▼
    排序结果
```

## 6. 存储结构

### 6.1 全局存储

```
~/.agent_fs/
├── config.yaml          # 全局配置
├── registry.json        # 已索引目录列表
└── storage/
    ├── vectors/         # LanceDB 向量库
    ├── bm25/            # BM25 索引
    └── cache/           # Embedding 缓存
```

### 6.2 本地索引元数据

```
项目目录/.fs_index/
├── index.json           # 索引元数据
└── documents/
    └── {filename}/
        └── content.md   # 转换后的 Markdown
```

### 6.3 字段命名约定

| 场景 | 命名风格 | 示例 |
|------|----------|------|
| 外部文件 (JSON) | camelCase | `fileName`, `indexedAt` |
| 内部存储 (DB) | snake_case | `file_name`, `chunk_id` |

## 7. 配置系统

### 7.1 配置文件位置

优先级从高到低：
1. 环境变量
2. 项目目录 `.agent_fs/config.yaml`
3. 全局 `~/.agent_fs/config.yaml`

### 7.2 配置结构

```yaml
llm:
  provider: openai
  baseUrl: https://api.openai.com/v1
  apiKey: ${OPENAI_API_KEY}
  model: gpt-4o-mini

embedding:
  provider: local  # local | api
  modelName: Xenova/bge-small-zh-v1.5

indexing:
  minTokens: 600
  maxTokens: 1200

search:
  topK: 10
  fusionMethod: rrf
```

## 8. 插件开发

### 8.1 纯 TypeScript 插件

适用于：不依赖外部程序的格式（如 Markdown）

```typescript
import { DocumentPlugin } from '@agent-fs/core';

export const markdownPlugin: DocumentPlugin = {
  name: 'markdown',
  version: '1.0.0',
  supportedExtensions: ['.md'],

  async convert(filePath) {
    // 读取并处理文件
    return { markdown, mappings };
  },

  parseLocator(locatorStr) {
    // 解析位置标识符
    return { line, column };
  }
};
```

### 8.2 混合插件 (TS + 外部程序)

适用于：需要调用外部程序的格式（如 DOCX、Excel）

**通信协议：** stdio JSON

```
TypeScript 插件  ──stdin──>  外部程序 (.NET)
                <──stdout──
```

**协议格式：**
```json
// Request (单行)
{"action":"convert","filePath":"/path/to/file.docx"}

// Response (单行)
{"success":true,"markdown":"...", "mappings":[...]}
```

## 9. 测试策略

### 9.1 测试类型

| 类型 | 位置 | 框架 |
|------|------|------|
| 单元测试 | 各 package 内 | Vitest |
| 集成测试 | packages/e2e | Vitest |

### 9.2 E2E 测试套件

位于 `packages/e2e/src/f-post/`：

| 测试文件 | 覆盖范围 |
|----------|----------|
| markdown-plugin.e2e.ts | Markdown 插件 |
| vector-store.e2e.ts | 向量存储 CRUD |
| bm25-search.e2e.ts | BM25 搜索 |
| fusion-search.e2e.ts | 多路融合 |
| full-pipeline.e2e.ts | 完整流水线 |

## 10. 开发计划状态

| 计划 | 状态 | 说明 |
|------|------|------|
| A - Foundation | ✅ 完成 | Monorepo、类型定义 |
| B1 - Config | ✅ 完成 | 配置系统 |
| B2 - Chunker | ✅ 完成 | 文本切分 |
| B3 - BM25 | ✅ 完成 | 全文搜索 |
| B4 - Markdown Plugin | ✅ 完成 | Markdown 处理 |
| C1 - Embedding | ✅ 完成 | 向量化服务 |
| C2 - Summary | ✅ 完成 | Summary 生成 |
| D - Vector Store | ✅ 完成 | 向量存储 |
| E - Fusion | ✅ 完成 | 多路融合 |
| F - Indexer | ✅ 完成 | 索引流程 |
| P1 - PDF Plugin | ✅ 完成 | PDF 处理 |
| P2 - DOCX Plugin | 🔄 进行中 | DOCX 处理 |
| P3 - Excel Plugin | 🔄 进行中 | Excel 处理 |
| G1 - MCP Server | 📋 计划中 | AI Agent 接口 |
| G2 - Electron App | 📋 计划中 | 桌面应用 |

---

*文档版本: 1.0*
*更新日期: 2025-02-04*

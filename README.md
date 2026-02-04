# Agent FS

> 面向 AI Agent 的文件系统智能索引工具

Agent FS 让 AI Agent 能够检索和理解用户本地文档。通过索引 PDF、DOCX、Excel、Markdown 等格式的文件，AI Agent 可以通过 MCP 协议进行语义搜索和精准查询。

## 特性

- **多格式支持** - PDF / DOCX / DOC / XLSX / XLS / Markdown
- **混合搜索** - 向量语义搜索 + BM25 关键词搜索，RRF 融合排序
- **中文优化** - nodejieba 中文分词，支持中文 Embedding 模型
- **本地优先** - 数据存储在本地，保护隐私
- **插件化** - 文档处理插件独立可扩展

## 快速开始

### 环境要求

- Node.js 18+
- pnpm 8+
- .NET 8 SDK（DOCX/Excel 插件需要）

### 安装

```bash
# 克隆仓库
git clone https://github.com/your-org/agent-fs.git
cd agent-fs

# 安装依赖
pnpm install

# 构建所有包
pnpm build
```

### 配置

创建全局配置文件 `~/.agent_fs/config.yaml`：

```yaml
llm:
  provider: openai
  baseUrl: https://api.openai.com/v1
  apiKey: ${OPENAI_API_KEY}
  model: gpt-4o-mini

embedding:
  provider: local  # 使用本地模型，无需联网
  modelName: Xenova/bge-small-zh-v1.5

indexing:
  minTokens: 600
  maxTokens: 1200

search:
  topK: 10
  fusionMethod: rrf
```

### 使用

```typescript
import { Indexer } from '@agent-fs/indexer';

// 创建索引器
const indexer = new Indexer();

// 索引目录
await indexer.index('/path/to/documents');

// 搜索
const results = await indexer.search('如何处理文档');
```

## 项目结构

```
agent_fs/
├── packages/
│   ├── core/           # 核心类型和工具
│   ├── search/         # 搜索引擎 (BM25 + 向量 + 融合)
│   ├── llm/            # LLM 服务 (Embedding + Summary)
│   ├── indexer/        # 索引流程
│   ├── plugins/        # 文档处理插件
│   │   ├── plugin-markdown/
│   │   ├── plugin-pdf/
│   │   ├── plugin-docx/
│   │   └── plugin-excel/
│   └── e2e/            # 集成测试
└── docs/               # 文档
```

## 架构

```
┌─────────────────────────────────────────────────┐
│              应用层 (MCP Server / Electron)      │
├─────────────────────────────────────────────────┤
│              索引层 (@agent-fs/indexer)          │
├─────────────────────────────────────────────────┤
│   服务层 (@agent-fs/search + @agent-fs/llm)     │
├─────────────────────────────────────────────────┤
│              插件层 (plugins/*)                  │
├─────────────────────────────────────────────────┤
│              核心层 (@agent-fs/core)             │
└─────────────────────────────────────────────────┘
```

详细架构说明见 [架构文档](docs/architecture.md)。

## 开发

### 常用命令

```bash
pnpm build           # 构建所有包
pnpm test            # 运行测试
pnpm test:coverage   # 测试覆盖率
pnpm test:f-post     # 集成测试
pnpm lint            # 代码检查
pnpm clean           # 清理构建产物
```

### 包说明

| 包 | 说明 |
|---|---|
| @agent-fs/core | 核心类型定义、配置加载、文本切分 |
| @agent-fs/search | BM25 索引、向量存储、融合搜索 |
| @agent-fs/llm | Embedding 服务、Summary 生成 |
| @agent-fs/indexer | 索引流程、插件管理 |
| @agent-fs/plugin-* | 文档格式处理插件 |

## 文档

- [需求文档](docs/requirements.md) - 功能需求规格
- [架构文档](docs/architecture.md) - 系统架构设计
- [代码规范](docs/guides/code-standards.md) - 编码规范
- [插件开发指南](docs/guides/plugin-development.md) - 创建自定义插件

## 技术栈

| 组件 | 技术 |
|------|------|
| 主框架 | TypeScript / Node.js |
| 包管理 | pnpm workspace |
| 向量存储 | LanceDB |
| 全文搜索 | 自实现 BM25 + nodejieba |
| Embedding | @xenova/transformers / OpenAI API |
| 文档转换 | .NET 8 + NPOI |
| 测试 | Vitest |

## 开发状态

- [x] 核心基础设施 (A)
- [x] 配置系统 (B1)
- [x] 文本切分 (B2)
- [x] BM25 搜索 (B3)
- [x] Markdown 插件 (B4)
- [x] Embedding 服务 (C1)
- [x] Summary 服务 (C2)
- [x] 向量存储 (D)
- [x] 融合搜索 (E)
- [x] 索引流程 (F)
- [ ] PDF 插件 (P1) - 进行中
- [x] Word 插件 (P2) 
- [x] Excel 插件 (P3)
- [ ] MCP Server (G1) - 计划中
- [ ] Electron 应用 (G2) - 计划中

## License

MIT

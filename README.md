# Agent FS

> 让 AI Agent 检索你的本地文档

Agent FS 是一个本地文档智能索引工具。选择文件夹，自动索引 PDF、Word、Excel、Markdown 等文档，然后 AI Agent（如 Claude、ChatGPT）就能通过 MCP 协议搜索和理解你的文件内容。

<!-- TODO: 添加界面截图
![客户端界面](docs/assets/screenshot-app.png)
-->

## 为什么用 Agent FS

- **数据不离开本机** - 索引和存储全部在本地完成，文档内容不上传到任何云端
- **中文搜索优化** - nodejieba 中文分词 + 中文 Embedding 模型，中文文档检索效果好
- **混合搜索** - 语义向量搜索 + 关键词倒排检索，RRF 融合排序，兼顾精确匹配和语义理解
- **多格式支持** - PDF / DOCX / DOC / XLSX / XLS / Markdown，插件化架构可扩展
- **即插即用** - Electron 桌面客户端管理索引，MCP Server 让 AI Agent 直接查询

## 安装

### 环境要求

- Node.js 18+
- pnpm 8+
- .NET 8 SDK（DOCX/Excel 插件需要）

### 从源码构建

```bash
git clone https://github.com/your-org/agent-fs.git
cd agent-fs

pnpm install
pnpm build
```

### 安装 macOS 桌面应用到 Applications

完成依赖安装后，可以直接执行：

```bash
./scripts/install_macos.sh
```

如果已经有可复用的 `.app` 打包产物，也可以跳过构建，直接覆盖安装：

```bash
./scripts/install_macos.sh --skip-build
```

## 使用

### 1. 启动桌面客户端

桌面客户端用于管理索引 — 选择文件夹、查看索引状态。

```bash
./scripts/run.sh -d
```

等价命令（不使用脚本时）：

```bash
pnpm --filter @agent-fs/electron-app dev
```

操作步骤：

1. 点击「选择文件夹」按钮，选择你要索引的文档目录
2. 目录会立即出现在左侧项目列表中，随后显示进度：扫描文件 → 转换文档 → 切分内容 → 生成摘要 → 计算向量 → 写入索引
3. 索引完成后，该目录即可用于搜索和项目管理

<!-- TODO: 添加索引过程截图
![索引进度](docs/assets/screenshot-indexing.png)
-->

### 2. 配置 MCP Server（让 AI Agent 查询你的文档）

MCP Server 是 AI Agent 访问索引的接口。构建完成后，将以下配置添加到你的 AI 客户端：

**Claude Desktop** — 编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "agent-fs": {
      "command": "node",
      "args": ["<项目路径>/packages/mcp-server/dist/index.js"]
    }
  }
}
```

**Claude Code** — 编辑 `.mcp.json`：

```json
{
  "mcpServers": {
    "agent-fs": {
      "command": "node",
      "args": ["<项目路径>/packages/mcp-server/dist/index.js"]
    }
  }
}
```

> 将 `<项目路径>` 替换为 agent-fs 的实际绝对路径。

配置完成后，AI Agent 会获得以下工具：

| 工具 | 说明 |
|------|------|
| `list_indexes` | 列出所有已索引的目录及摘要 |
| `search` | 语义搜索 + 关键词搜索，支持指定搜索范围 |
| `dir_tree` | 查看目录的文件结构和摘要 |
| `get_chunk` | 获取指定文档片段的详细内容及上下文 |

### 3. 配置文件（可选）

创建 `~/.agent_fs/config.yaml` 自定义行为：

```yaml
llm:
  provider: openai
  baseUrl: https://api.openai.com/v1
  apiKey: ${OPENAI_API_KEY}
  model: gpt-4o-mini

embedding:
  provider: local        # 本地模型，无需联网
  modelName: Xenova/bge-small-zh-v1.5

indexing:
  minTokens: 600
  maxTokens: 1200

search:
  topK: 10
  fusionMethod: rrf
```

默认使用本地 Embedding 模型，无需配置 API Key 即可开始使用。

## 注意事项

- 索引数据存储在被索引目录下的 `.fs_index` 文件夹中，删除即可清除索引
- 全局注册信息位于 `~/.agent_fs/registry.json`
- 首次索引时需要下载 Embedding 模型（约 100MB），之后离线可用
- DOCX 和 Excel 文件的解析依赖 .NET 8 SDK，纯 Markdown/PDF 场景可以不安装

## 开发

### 常用命令

```bash
pnpm native:check    # 检查 nodejieba native 架构
pnpm native:sync     # 自动重建并统一 nodejieba native 架构
pnpm build           # 构建所有包
pnpm test            # 运行测试
pnpm test:coverage   # 测试覆盖率
pnpm lint            # 代码检查
pnpm clean           # 清理构建产物
```

`pnpm build` 与 `packages/electron-app` 下的 `pnpm dev/build` 已自动串联 `native:sync`，编译前会先完成 native 架构统一。

Electron 桌面端打包时会自动解包 `nodejieba` 词典资源，避免发布版在索引写入阶段因分词词典无法被原生库读取而崩溃。

如需在本机安装 Electron 桌面应用，可执行 `./scripts/install_macos.sh`。

### 项目结构

```
agent_fs/
├── packages/
│   ├── core/           # 核心类型和工具
│   ├── indexer/        # 索引流程
│   ├── search/         # 搜索引擎（倒排 + 向量 + 融合）
│   ├── llm/            # LLM / Embedding 服务
│   ├── storage/        # AFD 存储（Rust + N-API）
│   ├── mcp-server/     # MCP Server
│   ├── electron-app/   # 桌面客户端
│   └── plugins/        # 文档处理插件
└── docs/               # 设计文档
```

### 相关文档

- [架构文档](docs/architecture.md) - 系统架构设计
- [代码规范](docs/guides/code-standards.md) - 编码规范
- [插件开发指南](docs/guides/plugin-development.md) - 创建自定义文档处理插件

## License

MIT

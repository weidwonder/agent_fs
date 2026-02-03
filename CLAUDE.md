# CLAUDE.md or Agent.md

> Agent FS - 面向 AI Agent 的文件系统智能索引工具

## 文档导航

```
首次了解项目
└─> 阅读本文档

理解需求
└─> docs/requirements.md

理解架构设计
└─> docs/plans/2025-02-02-agent-fs-design.md（设计文档）

本地 Embedding/Rerank 设计
└─> docs/plans/2026-02-03-local-embedding-rerank-design.md

本地 Embedding/Rerank 实施计划
└─> docs/plans/2026-02-03-local-embedding-rerank.md

开发规范
└─> docs/guides/code-standards.md

开始开发
└─> 待创建实施计划
```

## 项目概述

Agent FS 让 AI Agent 能够检索用户本地文档：

1. **索引** - 用户选择文件夹 → 自动处理 PDF/DOCX/XLSX/Markdown
2. **存储** - 在目标目录创建 `.fs_index` 保存索引数据
3. **查询** - AI Agent 通过 MCP 进行多路召回搜索

## 技术栈

| 组件 | 技术 |
|------|------|
| 主框架 | TypeScript / Node.js |
| 向量库 | LanceDB（文件型） |
| 全文搜索 | 自实现 BM25 + nodejieba |
| 桌面应用 | Electron + React |
| MCP | stdio 模式 |

## 项目结构

```
agent_fs/
├── CLAUDE.md                 # 本文件
├── docs/
│   ├── requirements.md       # 需求文档
│   ├── guides/               # 开发与操作指南
│   └── plans/                # 设计与计划
├── packages/                 # Monorepo（待创建）
│   ├── core/                 # 核心库
│   ├── indexer/              # 索引服务
│   ├── search/               # 搜索服务
│   ├── llm/                  # LLM 服务
│   ├── mcp-server/           # MCP Server
│   ├── electron-app/         # 桌面应用
│   └── plugins/              # 文档处理插件
└── ...
```

## 核心概念

| 概念 | 说明 |
|------|------|
| `.fs_index` | 每个被索引目录下的索引存储目录 |
| Chunk | 文档切分后的片段（0.6-1.2K token） |
| Locator | 插件定义的原文位置标识符 |
| Registry | `~/.agent_fs/registry.json`，记录所有已索引目录 |

## 更多信息

- [需求文档](docs/requirements.md) - 完整功能需求
- [设计文档](docs/plans/2025-02-02-agent-fs-design.md) - 架构与接口设计
- [代码规范](docs/guides/code-standards.md) - 编码与验证要求

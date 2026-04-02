# CLAUDE.md or Agents.md

> Agent FS - 面向 AI Agent 的文件系统智能索引工具

## 用户说明（面向编码代理）
当前项目处在初期阶段，不要考虑任何兼容性。旧结构的代码或者发现孤儿函数、代码等请全部移除。要保持代码更新后对应文档也要更新。

## 文档导航

```
首次了解项目
└─> 阅读本文档

理解需求
└─> docs/requirements.md

理解架构设计
└─> docs/architecture.md（系统架构）

本地 Embedding/Rerank 设计
└─> docs/plans/2026-02-03-local-embedding-rerank-design.md

本地 Embedding/Rerank 实施计划
└─> docs/plans/2026-02-03-local-embedding-rerank.md

开发规范
└─> docs/guides/code-standards.md

插件开发
└─> docs/guides/plugin-development.md

设计历史
└─> docs/plans/2025-02-02-agent-fs-design.md（原始设计文档）

云端知识库重构设计
└─> docs/specs/2026-03-30-cloud-knowledge-base-design.md

云端知识库实施计划
└─> docs/plans/2026-03-30-cloud-knowledge-base/plan.md

云端部署指南
└─> docs/guides/cloud-deployment.md

182.92.22.224 部署记录
└─> docs/guides/2026-03-30-182-92-22-224-deployment-record.md

快速上手（用户使用流程）
└─> docs/guides/getting-started.md

MCP 客户端接入（Claude Desktop / Cursor 等）
└─> docs/guides/mcp-client-integration.md

运维手册（备份、扩容、监控）
└─> docs/guides/operations.md
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
| 全文搜索 | SQLite 倒排索引 + nodejieba |
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
├── packages/                 # Monorepo 包
│   ├── core/                 # 核心库
│   ├── indexer/              # 索引服务
│   ├── search/               # 搜索服务
│   ├── llm/                  # LLM 服务
│   ├── storage/              # AFD 存储（Rust + N-API）
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
| Registry | `~/.agent_fs/registry.json`，记录已索引 Project 与子目录引用 |

## 更多信息

- [需求文档](docs/requirements.md) - 完整功能需求
- [架构文档](docs/architecture.md) - 系统架构与模块说明
- [代码规范](docs/guides/code-standards.md) - 编码与验证要求
- [插件开发指南](docs/guides/plugin-development.md) - 创建自定义文档处理插件
- [快速上手指南](docs/guides/getting-started.md) - 注册、建库、上传、搜索完整流程
- [MCP 客户端接入](docs/guides/mcp-client-integration.md) - 配置 AI 工具连接知识库
- [运维手册](docs/guides/operations.md) - 备份恢复、扩容、监控、安全加固

# P0 功能设计文档

> 2026-02-09 | 基于 .user.idea 的 P0 任务方案

## 概览

| 任务 | 说明 | 复杂度 |
|------|------|--------|
| P0-1 | Markdown 插件支持 `.txt` 文档 | 极低 |
| P0-2 | `.fs_index/memory/` 项目结构记忆 | 中等 |
| P0-3 | 研究召回路线和准确率 | 研究型 |

---

## P0-1: Markdown 插件支持 `.txt` 文档

### 现状

- `MarkdownPlugin` 当前 `supportedExtensions = ['md', 'markdown']`
- `.txt` 与 Markdown 处理逻辑完全一致（纯文本即有效 Markdown）

### 方案

在 `MarkdownPlugin.supportedExtensions` 中添加 `'txt'`。

**改动文件**：
- `packages/plugins/plugin-markdown/src/plugin.ts` — `supportedExtensions` 加 `'txt'`

无需其他改动，段落映射、locator 格式均复用现有逻辑。

---

## P0-2: `.fs_index/memory/` 项目结构记忆

### 需求

在 Project 的 `.fs_index` 下增加 `memory/` 目录，供 AI Agent 和用户存储项目级结构化记忆。

### 存储结构

```
<project>/.fs_index/
├── memory/
│   ├── project.md          # 项目介绍（必须）
│   └── extend/             # 项目经验目录
│       ├── coding-style.md
│       └── ...             # 任意 markdown，约定须在 project.md 引用
├── index.json
└── documents/
```

### 设计决策

| 决策项 | 结论 | 理由 |
|--------|------|------|
| 写入方式 | MCP 返回路径 + 用户通过 Electron 编辑 | AI 用自己的文件工具读写 |
| 使用方式 | 专用 MCP 工具 `get_project_memory` | 按需获取，不污染其他工具输出 |
| 索引策略 | **不参与**向量索引和搜索 | 保持 memory 与文档索引独立 |
| extend/ 引用校验 | 仅作为约定，不做强制校验 | 简单，由 AI 自行遵守 |

### MCP 工具设计

#### `get_project_memory`

**输入**：

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| project | string | 是 | projectId 或 projectPath |

**输出**：

```json
{
  "memoryPath": "/abs/path/to/.fs_index/memory",
  "exists": true,
  "projectMd": "# My Project\n...",
  "files": [
    { "path": "project.md", "size": 1024 },
    { "path": "extend/coding-style.md", "size": 512 }
  ]
}
```

- 当 `exists=false` 时，`projectMd` 为空，`files` 为空数组
- AI Agent 拿到 `memoryPath` 后可用自己的文件工具进行读写

### Electron UI 设计

- 位置：项目详情页
- 功能：
  - 显示 `project.md` 内容
  - 列出 `extend/` 目录下的文件
  - 提供内联 markdown 编辑器（读写 `.fs_index/memory/` 下的文件）

### Indexer 改动

- `scanDirectory()` 扫描时跳过 `memory/` 目录（与 `.fs_index` 同理）
- 索引流水线无需改动

### 影响的文件

| 包 | 文件 | 改动 |
|----|------|------|
| mcp-server | `src/tools/` | 新增 `get-project-memory.ts` |
| mcp-server | `src/server.ts` | 注册新工具 |
| indexer | `src/scanner.ts` | 确保 `memory/` 被排除 |
| electron-app | `src/renderer/` | 新增 memory 编辑 UI |
| electron-app | `src/main/` | 新增 memory 读写 IPC |

### project.md 初始内容生成

索引完成后，若 `memory/project.md` 不存在，可基于 `directorySummary`（已有的目录 summary）自动生成初始版本。这与 summary 生成顺序一致 — 子目录 summary 先完成，最终根目录 summary 汇总后生成 `project.md`。

> **已验证**：`IndexPipeline.indexDirectoryTree()` 采用自底向上递归，子目录完整处理后才生成父目录 summary，顺序正确。

---

## P0-3: 研究召回路线和准确率

### 当前召回架构

```
Query
  ├─ Content Vector Search (topK * 3)
  ├─ Summary Vector Search (topK * 3)
  └─ Inverted Index Search (topK * 3)
        ↓
  RRF 融合 (k=60)
        ↓
  Top-K 结果
```

### 研究目标

1. 建立准确率基线（Precision@K, Recall@K, MRR）
2. 评估三路召回各自贡献度与互补性
3. 评估 RRF 参数（k 值）是否最优
4. 评估 Rerank 的潜在增益

### 实施步骤

1. **选取评测数据**：使用已索引的真实项目
2. **构造测试 query 集**：
   - 语义查询（"这个项目的认证机制是什么"）
   - 精确关键词（"nodejieba 配置"）
   - 混合查询（语义 + 关键词）
3. **标注 ground truth**：人工标注每个 query 的期望命中 chunk
4. **分别评测**：
   - 仅 Content Vector
   - 仅 Summary Vector
   - 仅 Inverted Index
   - RRF 融合
   - RRF + Rerank
5. **输出报告**：各路指标对比、参数建议、改进方向

### 交付物

- 评测脚本（可复用）
- 评测数据集（query + ground truth）
- 基线报告（`plans/reports/`）

---

## 实施优先级

1. **P0-1**（txt 支持）— 1 行改动，立即完成
2. **P0-2**（memory）— MCP + Indexer + Electron 三端改动
3. **P0-3**（召回研究）— 独立研究任务，可与 P0-2 并行

---

*文档版本: 1.0*
*创建日期: 2026-02-09*

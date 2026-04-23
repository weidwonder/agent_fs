---
date: '2026-04-22'
status: '设计已确认'
documentRole: 'spec'
sourceOfTruth: './2026-04-22-knowledge-clue-requirements.md'
phase: 0
---

# Knowledge Clue Phase 0 — 设计规格

> **文档治理**：本文档从属于 [Knowledge Clue PRD](./2026-04-22-knowledge-clue-requirements.md)。若冲突以 PRD 为准。

## 1. Phase 0 目标

在现有文档索引检索系统上叠加"多线索知识组织"能力，全链路打通：Core 类型 → 存储层 → LLM 标注 → MCP 工具 → 搜索集成 → Electron UI。

## 2. 核心设计隐喻：文件系统

Clue 的整体设计以**文件系统**为隐喻。一个 Clue 就是一个虚拟文件系统的根目录，内部的组织方式完全映射文件系统概念：

| 文件系统概念 | Clue 对应 | 说明 |
|-------------|-----------|------|
| 目录（folder） | ClueFolder | 包含子节点，有组织模式（tree/timeline） |
| 文件（file） | ClueLeaf | 终端节点，指向一个 Segment（文档片段或整个文档） |
| 路径（path） | 节点路径 | 从 root 到节点的 name 拼接，如 `基础认证/2024-03` |
| `ls` | `browse_clue` | 列出目录内容（名称 + 摘要） |
| `cat` | `read_clue_leaf` | 读取文件内容（Segment 正文 + 来源定位） |
| `mkdir` | `clue_add_folder` | 创建子目录 |
| 创建文件 | `clue_add_leaf` | 创建叶子节点 |
| `rm -r` | `clue_remove_node` | 删除节点及其子树 |

**核心规则：**

1. **路径即身份**：节点不设 ID，一律通过路径定位。同层节点不允许重名。
2. **内容与结构分离**：浏览目录（`browse_clue`）只展示结构和摘要，不暴露文件定位信息；读取文件（`read_clue_leaf`）时才返回正文和来源定位。
3. **目录自描述**：每个 folder 声明自己的组织模式（tree 或 timeline），决定子节点的排列和命名约束。
4. **透明穿透**：leaf 的来源定位指向真实文档位置（fileId + 行号），Consumer 可用现有 `read_md` 穿透到原始文档。

## 3. 核心设计决策

| 决策 | 结论 |
|------|------|
| Chunk / Segment 关系 | 双轨共存：Chunk 负责 embedding 搜索，Segment 负责 Clue 导航 |
| Clue 类型 | 仅 Tree + Timeline，可混合嵌套；去掉 Hash/Tag |
| 结构隐喻 | 文件系统——folder(tree/timeline) + leaf(doc/range)，每个 folder 有组织模式 |
| Segment 粒度 | 灵活：整个文档（doc）或文档内行号区间（range） |
| 创建流程 | Clue 驱动：对话明确主题 → 生成 Principle → 骨架确认 → LLM 自主逐层展开 |
| 存储方式 | 遵循现有 .fs_index 文件系统模式，新增 ClueAdapter |
| 增量更新 | 文档变更后，Indexer 管线末尾触发 Clue 同步，LLM 按 Principle 判断 |
| MCP 工具 | 分两侧：Builder Agent（CRUD 操作）+ Consumer Agent（导航定位） |

## 4. 数据模型

### 4.1 Segment

文档上的虚拟标注，不破坏原始文档完整性。

```typescript
interface Segment {
  fileId: string;                // 关联 FileMetadata.fileId
  type: 'document' | 'range';   // 整个文档 / 行号区间
  anchorStart?: number;          // range 时：行号（1-based）
  anchorEnd?: number;
}
```

### 4.2 ClueNode

Clue 树中的节点，discriminated union。**节点无 ID，通过路径定位**（如 `基础认证/2024-03`）。

```typescript
type ClueNode = ClueFolder | ClueLeaf;

interface ClueFolder {
  kind: 'folder';
  organization: 'tree' | 'timeline';
  timeFormat?: string;           // timeline 时必填，如 'YYYY-MM'
  name: string;
  summary: string;
  children: ClueNode[];
}

interface ClueLeaf {
  kind: 'leaf';
  name: string;
  summary: string;
  segment: Segment;              // 内联引用
}
```

**路径定位规则**：节点通过从 root 到自身的 `name` 拼接为路径，如 `基础认证/2024-03`。路径在同一 Clue 内天然唯一（同层不允许重名，与文件系统一致）。

Segment 内联在 ClueLeaf 中，不独立存储。原因：Clue 驱动发现 Segment，每个 Segment 天然属于某个 Leaf，无需跨 Clue 共享。

### 4.3 Clue

```typescript
interface Clue {
  id: string;                    // "clue-" + nanoid（存储文件名用）
  projectId: string;
  name: string;                  // 同一项目内唯一（类似挂载点名称）
  description: string;
  principle: string;             // 骨架确认后 LLM 生成的指导原则
  createdAt: string;             // ISO 8601
  updatedAt: string;
  root: ClueFolder;              // Clue 本身即根 folder
}
```

**约束**：同一 `projectId` 下 Clue `name` 必须唯一。`id` 仅用于存储层文件命名，MCP 工具对外使用 `clue_id` 定位。

**Principle** 示例：

```
本 Clue 追踪认证系统的技术演进，按模块（tree）组织顶层，
每个模块内部按时间线（timeline）排列关键决策节点。
关注范围：认证协议选型、Token 管理策略、密钥轮换机制。
排除范围：前端 UI 交互、第三方 OAuth Provider 配置细节。
时间粒度：月级（YYYY-MM）。
```

Principle 作用：创建时指导内容选取，增量更新时判断新/改文档是否属于关注范围。

### 4.4 锚定方式

采用行号（1-based）而非字符偏移。原因：
- 现有 Chunk 已用行号（lineStart/lineEnd），保持一致
- 行号在文档更新后更容易重新对齐

## 5. 存储布局

### 5.1 文件结构

```
<project>/.fs_index/
├── index.json                  # 现有（不改）
├── documents/                  # 现有（不改）
├── clues/                      # 新增
│   ├── registry.json           # Clue 列表索引
│   ├── <clue-id>.json          # 完整 Clue 数据（序列化 Clue 类型）
│   └── <clue-id>.json
```

### 5.2 registry.json

```json
{
  "clues": [
    { "id": "clue-001", "name": "Auth系统演进", "updatedAt": "2026-04-22T..." },
    { "id": "clue-002", "name": "数据库设计决策", "updatedAt": "2026-04-22T..." }
  ]
}
```

### 5.3 ClueAdapter

新增为 StorageAdapter 的第五个子适配器：

```typescript
interface ClueAdapter {
  init(): Promise<void>;
  listClues(projectId: string): Promise<ClueSummary[]>;
  getClue(clueId: string): Promise<Clue | null>;
  saveClue(clue: Clue): Promise<void>;      // create + update 合并
  deleteClue(clueId: string): Promise<void>;
  close(): Promise<void>;
}

interface StorageAdapter {
  vector: VectorStoreAdapter;
  invertedIndex: InvertedIndexAdapter;
  archive: DocumentArchiveAdapter;
  metadata: MetadataAdapter;
  clue: ClueAdapter;                         // 新增
  init(): Promise<void>;
  close(): Promise<void>;
}
```

接口精简原因：节点级操作在内存中完成，改完后 `saveClue()` 整体写回。Clue 数据量小，不需要细粒度持久化。

## 6. 内部树操作函数

纯内存操作，不对外暴露，供 LLM Agent 流程和 Clue 管理服务内部调用：

```typescript
createClue(projectId, name, description, principle, rootOrganization): Clue
addChild(clue, parentPath, node: ClueNode): Clue
removeNode(clue, nodePath): Clue
updateNode(clue, nodePath, updates): Clue
findNode(clue, nodePath): ClueNode | null
listLeaves(clue): ClueLeaf[]
renderTree(clue, nodePath?): string
```

## 7. LLM Agent 创建流程

### 7.1 Builder Agent 工具集

LLM 以 Agent 模式自主操作，拥有以下工具：

**信息探索（复用现有）：** `search` / `read_md` / `get_chunk` / `list_indexes` / `dir_tree`

**Clue 结构操作（新增）：** `clue_create` / `clue_delete` / `clue_add_folder` / `clue_add_leaf` / `clue_update_node` / `clue_remove_node` / `clue_get_structure`

### 7.2 创建流程

```
用户：描述 Clue 主题
  ↓
LLM：读取项目文件列表 + 目录摘要，理解项目内容全貌
  ↓
LLM ↔ 用户：多轮对话明确范围、组织方式、粒度
  ↓
LLM：生成 Principle + 创建 Clue 骨架（仅 folders）
  ↓
用户：确认/调整骨架
  ↓
LLM：逐个 folder 展开
  ├── 用 search() 召回候选
  ├── 用 read_md() / get_chunk() 深入阅读（自行决定全量或抽样）
  ├── 自主判断相关区间，创建 leaf（含 Segment + summary）
  └── 只覆盖与 Clue 目标相关的片段，不要求覆盖所有文档
  ↓
Clue 完成，持久化
```

### 7.3 增量更新流程

```
文档变更（手动触发索引）
  ↓
Indexer：convert → chunk → embed → write（现有流程）
  ↓
检查 clues/registry.json 是否有 Clue
  ↓ 有
遍历每个 Clue：
  ├── 读取 Principle
  ├── 新增文档：LLM 读取摘要 + Principle → 判断是否相关 → 相关则展开到对应 folder
  ├── 修改文档：通过 fileId 找到引用该文档的所有 leaf → LLM 重新读取 → 更新锚点/summary
  └── 删除文档：通过 fileId 找到引用该文档的所有 leaf → 直接移除
  ↓
保存更新后的 Clue
```

## 8. MCP 工具

### 8.1 Builder Agent 工具（创建/维护 Clue）

```typescript
clue_create: {
  project: string;
  name: string;
  description: string;
  principle: string;
  root_organization: 'tree' | 'timeline';
  root_time_format?: string;
} → { clue_id: string }

clue_delete: {
  clue_id: string;
} → { success: boolean }

clue_add_folder: {
  clue_id: string;
  parent_path: string;           // 父节点路径，如 "" 表示 root，"基础认证" 表示子 folder
  name: string;
  summary: string;
  organization: 'tree' | 'timeline';
  time_format?: string;
  position?: number;
} → { path: string }            // 新节点完整路径

clue_add_leaf: {
  clue_id: string;
  parent_path: string;
  name: string;
  summary: string;
  file_id: string;
  segment_type: 'document' | 'range';
  anchor_start?: number;
  anchor_end?: number;
  position?: number;
} → { path: string }

clue_update_node: {
  clue_id: string;
  node_path: string;
  name?: string;
  summary?: string;
  organization?: 'tree' | 'timeline';
  time_format?: string;
  anchor_start?: number;
  anchor_end?: number;
} → { success: boolean }

clue_remove_node: {
  clue_id: string;
  node_path: string;
} → { removed_count: number }

clue_get_structure: {
  clue_id: string;
  node_path?: string;
} → { tree: string }  // 文本树形结构
```

### 8.2 Consumer Agent 工具（浏览 Clue）

```typescript
list_clues: {
  project: string;
} → {
  clues: Array<{ id, name, description, leaf_count, updated_at }>
}

browse_clue: {
  clue_id: string;
  node_path?: string;    // 不传从 root 开始
  depth?: number;        // 默认 1
} → {
  tree: string;
}

read_clue_leaf: {
  clue_id: string;
  node_path: string;     // leaf 路径，如 "基础认证/2024-03"
} → {
  title: string;
  content: string;
  source: {
    path: string;
    file_id: string;
    line_start: number;
    line_end: number;
  };
}
```

**browse_clue 返回结构：**

```json
{
  "tree": "Auth系统演进/  # 认证系统从 session 到 OAuth2 的完整技术演进\n├── 基础认证/  # [timeline:YYYY-MM] Session → JWT 的基础认证演进历程"
}
```

其中 `tree` 字段内容示例：

```
Auth系统演进/                          # 认证系统从 session 到 OAuth2 的完整技术演进
├── 基础认证/                          # [timeline:YYYY-MM] Session → JWT 的基础认证演进历程
├── OAuth2改造/                        # [timeline:YYYY-MM] OAuth2 接入与 Refresh Token 轮换
├── 权限体系/                          # [tree] RBAC 模型与资源隔离设计
└── 总体设计原则                       # [doc] 认证系统的核心设计约束
```

深入 folder：

```
基础认证/                              # [timeline:YYYY-MM] Session → JWT 的基础认证演进历程
├── 2024-03                            # [range] 从 Session 迁移到 JWT 初始方案
├── 2024-08                            # [doc] JWT 签名算法升级与密钥轮换
└── 2024-12/                           # [tree] 年末安全审计与改进
```

树输出只展示名称、类型、摘要，不含文件定位。Consumer 通过 summary 判断是否需要深入阅读。

**read_clue_leaf 返回结构：**

```json
{
  "title": "从 Session 迁移到 JWT 初始方案",
  "content": "2024 年 3 月，团队决定从 Session 认证迁移到 JWT...",
  "source": {
    "path": "docs/auth/jwt-migration.md",
    "file_id": "abc123",
    "line_start": 10,
    "line_end": 85
  }
}
```

其中 `content` 为 Segment 正文；`source` 可用于后续调用 `read_md` 继续读取全文或其他区间。

## 9. 搜索集成

现有 `search` 工具不改动接口。在内部结果类型中附加 Clue 上下文：

```typescript
interface SearchResult {
  // ... 现有字段不变
  clueRefs?: Array<{
    clueId: string;
    clueName: string;
    leafPath: string;            // 如 "基础认证/2024-03"
  }>;
}
```

MCP 工具序列化输出时，字段名转换为 `clue_refs`，元素字段为 `clue_id / clue_name / leaf_path`。

实现：搜索完成后，用结果的 fileId 扫描项目所有 Clue，找出引用这些 fileId 的 leaf 节点。Clue 数据量小，扫描成本低。

## 10. 文档变更与 Clue 同步

### 10.1 删除同步（自动，无需 LLM）

文档删除时，系统自动清理所有 Clue 中引用该文档的 leaf 节点：

1. 遍历项目所有 Clue（从 `clues/registry.json` 读取）
2. 在每个 Clue 树中查找 `segment.fileId` 匹配的 ClueLeaf
3. 移除匹配的 leaf 节点
4. 若某 folder 的 children 变空，级联移除该 folder
5. 保存更新后的 Clue

此逻辑在 Indexer `cleanupFileArtifacts` 末尾调用，与向量/倒排/AFD 清理同步执行。

ClueAdapter 新增方法：

```typescript
removeLeavesByFileId(projectId: string, fileId: string): Promise<{
  affectedClues: string[];   // 被修改的 Clue ID 列表
  removedLeaves: number;     // 移除的 leaf 数
  removedFolders: number;    // 级联移除的空 folder 数
}>
```

### 10.2 新增/修改通知（Webhook，外部 LLM 处理）

文档新增或修改时，Indexer 完成索引后通过 Webhook 通知外部 LLM 服务，由其自行调用 Builder MCP 工具整理 Clue。Indexer 本身不运行 LLM 来更新 Clue。

**配置：**

```yaml
# config.yaml
clue:
  webhook_url: "http://localhost:3000/clue-webhook"  # 可选，不配置则不通知
  webhook_secret: "..."                               # 可选，用于签名验证
```

**Webhook 请求格式：**

```typescript
POST {webhook_url}
Content-Type: application/json
X-Webhook-Signature: sha256=...    // 若配置了 secret

{
  event: 'documents_changed';
  project_id: string;
  project_path: string;
  timestamp: string;               // ISO 8601
  changes: Array<{
    file_id: string;
    file_path: string;             // 相对于 project_path 的路径，如 "docs/auth/jwt-migration.md"
    action: 'added' | 'modified';
    summary: string;               // 文档摘要
  }>;
}
```

**触发时机：** Indexer 完成所有文件处理并写入 IndexMetadata 后，异步发送（不阻塞索引流程）。

**设计原则：**
- Indexer 只负责通知，不关心 Clue 内容组织
- 外部服务收到通知后，可调用 Builder MCP 工具（clue_add_leaf、clue_update_node 等）自主整理
- Webhook 失败不影响索引流程（fire-and-forget，可配置重试）

## 11. Electron UI

### 11.1 Clue 列表面板

项目详情页新增"知识线索"Tab，展示 Clue 卡片（名称、描述、节点数、更新时间），支持打开、删除、触发更新。

### 11.2 Clue 树浏览器

左侧可展开/折叠的树结构，folder 节点显示组织模式标识。右侧选中 leaf 时展示 Segment 正文（从 AFD 读取）。Timeline folder 子节点按时间轴可视化排列。

### 11.3 Clue 创建向导

输入主题描述 → LLM 对话澄清 → 骨架预览/调整 → 展开进度 → 完成跳转浏览器。

### 11.4 IPC 接口

```typescript
ipcMain.handle('list-clues', (_, projectId) => ...)
ipcMain.handle('get-clue', (_, clueId, options) => ...)
ipcMain.handle('create-clue', (_, projectId, topic) => ...)
ipcMain.handle('update-clues', (_, projectId, clueId?) => ...)
ipcMain.handle('delete-clue', (_, clueId) => ...)

// 进度推送
ipcMain.emit('clue-creation-progress', { phase, folder, progress })
ipcMain.emit('clue-update-progress', { clueId, phase, progress })
```

## 12. 实现路径（自底向上）

```
Step 1: Core 类型定义（@agent-fs/core）
Step 2: 存储层（ClueAdapter 接口 + Local 实现）
Step 3: Clue 内部管理服务（树操作函数）
Step 4: LLM 集成（对话创建 + 自动发现 Segment + 增量更新）
Step 5: MCP 工具（Builder 侧 + Consumer 侧）
Step 6: 搜索集成（search 结果附加 clueRefs）
Step 7: Electron UI（列表 + 浏览器 + 创建向导）
```

每一步可独立测试和验证。

# Electron 客户端界面改造设计

> 日期：2026-02-07
> 状态：设计中

## 1. 需求概述

将当前极简的单页 Electron 客户端改造为功能完整的桌面应用，包含三大能力：

1. **项目管理** — 显示 Project 目录列表，支持描述查看/编辑、移除（含索引清理）、增量更新
2. **全局设置** — 右上角设置入口，模态对话框编辑 `~/.agent_fs/config.yaml`，可选 summary 模式
3. **可视化搜索** — 搜索框 + 范围标签 + 卡片式结果展示

## 2. 整体布局

```
┌──────────────────────────────────────────────────────────┐
│  Agent FS                                    [⚙ 设置]   │
├──────────────────┬───────────────────────────────────────┤
│                  │                                       │
│  项目列表         │  🔍 搜索框                            │
│                  │  [项目A标签] [项目B标签] [全选/取消]    │
│  ┌────────────┐  │                                       │
│  │ /path/to/A │  │  ┌─────────────────────────────────┐  │
│  │ 描述...     │  │  │ 搜索结果卡片 1                   │  │
│  │ [更新][删除] │  │  │ score: 0.85                     │  │
│  └────────────┘  │  │ summary: ...                     │  │
│                  │  │ content: ... (高亮)               │  │
│  ┌────────────┐  │  │ source: /path/file.md:L10-L20   │  │
│  │ /path/to/B │  │  └─────────────────────────────────┘  │
│  │ 描述...     │  │                                       │
│  │ [更新][删除] │  │  ┌─────────────────────────────────┐  │
│  └────────────┘  │  │ 搜索结果卡片 2                   │  │
│                  │  │ ...                               │  │
│  [+ 添加目录]    │  └─────────────────────────────────┘  │
│                  │                                       │
├──────────────────┴───────────────────────────────────────┤
│  状态栏：索引进度 / 搜索耗时                              │
└──────────────────────────────────────────────────────────┘
```

**布局细节**：
- 左侧侧边栏宽度 280px，可折叠
- 右侧主内容区自适应宽度
- 顶部标题栏使用 `titleBarStyle: 'hiddenInset'`（macOS 原生融合）
- 底部状态栏显示当前操作状态（索引进度、搜索耗时等）

## 3. 功能模块设计

### 3.1 项目管理（侧边栏）

#### 数据来源

读取 `~/.agent_fs/registry.json` 中 `projects` 数组，只显示 `valid: true` 的项目。

#### 项目卡片交互

每个项目卡片显示：

| 字段 | 展示方式 |
|------|----------|
| `path` | 完整路径，单行，超长截断（tooltip 显示完整路径） |
| `alias` | 作为卡片标题 |
| `summary` | 默认 2 行截断，点击展开全文，展开后可编辑 |
| `totalFileCount` / `totalChunkCount` | badge 显示 "12 文件 · 856 chunks" |
| `lastUpdated` | 相对时间 "2 小时前" |

#### 描述编辑

- 点击描述区域进入查看模式（展开全文）
- 查看模式下有"编辑"按钮
- 编辑模式：textarea 替换显示区，保存/取消按钮
- 保存时调用 IPC `update-project-summary` 更新 registry.json 中对应 project 的 `summary` 字段

#### 移除项目

- 点击删除按钮弹出 ConfirmDialog
- 警告文案：「确定移除项目 "{alias}"？此操作将删除 {path}/.fs_index 下的所有索引数据，不可恢复。」
- 确认后调用 IPC `remove-project`
- 后端执行：
  1. 删除 `{project.path}/.fs_index/` 目录（`rm -rf`）
  2. 删除全局存储中该项目的向量和倒排索引数据
  3. 从 `registry.json` 中移除该 project 条目
  4. 写回 `registry.json`

#### 增量更新

- 点击更新按钮触发 IPC `start-indexing`（复用现有逻辑）
- `Indexer.indexDirectory()` 内部已实现增量更新（基于文件 hash 检测变更）
- 更新期间该项目卡片显示进度条
- 状态栏显示当前阶段和进度

#### 添加目录

- 底部「+ 添加目录」按钮
- 点击后调用 `select-directory` IPC 弹出系统文件选择器
- 选择后立即开始索引（调用 `start-indexing`）

### 3.2 设置面板（模态对话框）

#### 触发方式

右上角齿轮图标按钮，点击弹出模态对话框。

#### 配置分组

对话框内用 Tab 或 Accordion 分组：

**Tab 1: LLM 配置**

| 字段 | 控件 | 说明 |
|------|------|------|
| `llm.provider` | 只读文本 | 固定 `openai-compatible` |
| `llm.base_url` | Input | API 地址 |
| `llm.api_key` | Password Input | API 密钥（显示/隐藏切换） |
| `llm.model` | Input | 模型名称 |

**Tab 2: Embedding 配置**

| 字段 | 控件 | 说明 |
|------|------|------|
| `embedding.default` | Select (`local` / `api`) | 默认模式 |
| `embedding.api.base_url` | Input | API Embedding 地址 |
| `embedding.api.api_key` | Password Input | API 密钥 |
| `embedding.api.model` | Input | 模型名称 |
| `embedding.local.model` | Input | 本地模型名称（当 default=local 时显示） |
| `embedding.local.device` | Select (`cpu` / `gpu`) | 计算设备 |

**Tab 3: Summary 配置**

| 字段 | 控件 | 说明 |
|------|------|------|
| `summary.mode` | Select (`batch` / `skip`) | 摘要生成模式 |
| `summary.chunk_batch_token_budget` | Number Input | Token 预算（默认 10000） |
| `summary.timeout_ms` | Number Input | 超时毫秒数 |
| `summary.max_retries` | Number Input | 重试次数（默认 3） |

**Tab 4: 索引 & 搜索**

| 字段 | 控件 | 说明 |
|------|------|------|
| `indexing.chunk_size.min_tokens` | Number Input | 最小 token 数 |
| `indexing.chunk_size.max_tokens` | Number Input | 最大 token 数 |
| `search.default_top_k` | Number Input | 默认返回数量 |
| `search.fusion.method` | 只读文本 | 固定 `rrf` |

**Tab 5: 插件配置**

| 字段 | 控件 | 说明 |
|------|------|------|
| `plugins.pdf.minerU.serverUrl` | Input | MinerU API 地址 |

#### 保存逻辑

- 保存按钮点击后调用 IPC `save-config`
- 后端将表单数据序列化为 YAML 写入 `~/.agent_fs/config.yaml`
- 注意：保存时需要保留配置文件中的环境变量引用（`${VAR}`）—— 实现方式：后端读取原始 YAML 文本，只替换用户修改过的字段
- 保存成功后显示 toast 提示

#### 加载逻辑

- 打开对话框时调用 IPC `get-config`
- 后端读取 `~/.agent_fs/config.yaml` 原始文本（不解析环境变量），返回两份数据：
  - `rawConfig`：YAML 解析后的原始值（可能包含 `${VAR}` 占位符）
  - `resolvedConfig`：环境变量已解析后的实际值
- 前端显示 `resolvedConfig` 的值，但标注哪些字段来自环境变量（不可编辑或编辑时警告）

### 3.3 可视化搜索（主内容区）

#### 搜索框

- 顶部搜索框，支持两个输入：
  - **主查询**（query）：Input，placeholder "语义搜索..."
  - **关键词**（keyword）：可选，Input，placeholder "精确关键词（可选）"
- 回车或点击搜索按钮触发搜索

#### 范围选择

- 搜索框下方显示所有 project 的标签（Badge）
- 每个标签显示 `alias`，可点击选择/取消
- 默认全选
- 提供"全选/取消全选"快捷操作

#### 搜索调用

- 调用 IPC `search`，传递 `{ query, keyword, scope, top_k }`
- scope 为选中项目的 `path` 数组

#### 结果卡片

每张搜索结果卡片包含：

```
┌──────────────────────────────────────────────┐
│ ⬆ 0.85                           📄 chunk_id │
├──────────────────────────────────────────────┤
│ 📝 摘要                                      │
│ 该段落介绍了...                               │
├──────────────────────────────────────────────┤
│ 📄 正文片段                                   │
│ ...匹配的文本内容，关键词**高亮**显示...        │
│                                              │
├──────────────────────────────────────────────┤
│ 📁 /path/to/file.md  ·  lines:10-20         │
└──────────────────────────────────────────────┘
```

**字段说明**：

| 字段 | 来源 | 展示 |
|------|------|------|
| score | `fusedItem.score` | 左上角 badge，颜色按分数梯度（绿>黄>灰） |
| chunk_id | `result.chunk_id` | 右上角小字 |
| summary | `result.summary` | 摘要区域 |
| content | `result.content` | 正文区域，搜索关键词高亮（用 `<mark>` 标签） |
| file_path | `result.source.file_path` | 底部来源，点击可复制路径 |
| locator | `result.source.locator` | 底部定位信息 |

**搜索元信息**：

在结果列表上方显示：
- 搜索耗时：`meta.elapsed_ms` ms
- 搜索范围：`meta.total_searched` 个 chunks
- 融合方法：`meta.fusion_method`

## 4. IPC 接口设计

### 4.1 现有接口（保留）

| 通道 | 方向 | 参数 | 返回 |
|------|------|------|------|
| `select-directory` | renderer → main | - | `string \| undefined` |
| `start-indexing` | renderer → main | `dirPath: string` | `{ success, metadata?, error? }` |
| `get-registry` | renderer → main | - | `Registry` |
| `indexing-progress` | main → renderer | `IndexProgress` | - |

### 4.2 新增接口

#### `remove-project`

```typescript
// renderer → main
ipcMain.handle('remove-project', async (_event, projectId: string) => {
  // 1. 读取 registry，找到对应 project
  // 2. 删除 {project.path}/.fs_index/ 目录
  // 3. 删除全局存储中该项目相关的向量索引（按 dirId 删除）
  // 4. 删除全局存储中该项目相关的倒排索引（按 dirId 删除）
  // 5. 从 registry.projects 中移除
  // 6. 写回 registry.json
  return { success: boolean; error?: string };
});
```

#### `update-project-summary`

```typescript
// renderer → main
ipcMain.handle('update-project-summary', async (_event, projectId: string, newSummary: string) => {
  // 1. 读取 registry
  // 2. 找到对应 project，更新 summary 字段
  // 3. 写回 registry.json
  return { success: boolean; error?: string };
});
```

#### `get-config`

```typescript
// renderer → main
ipcMain.handle('get-config', async () => {
  // 1. 读取 ~/.agent_fs/config.yaml 原始文本
  // 2. YAML 解析为对象（rawConfig）
  // 3. 解析环境变量后的对象（resolvedConfig）
  // 4. 标记哪些字段值来自环境变量
  return {
    rawConfig: Config;
    resolvedConfig: Config;
    envFields: string[];  // 来自环境变量的字段路径，如 ["llm.base_url", "llm.api_key"]
  };
});
```

#### `save-config`

```typescript
// renderer → main
ipcMain.handle('save-config', async (_event, configUpdates: Partial<Config>) => {
  // 1. 读取当前 config.yaml 原始文本
  // 2. YAML 解析
  // 3. 合并 configUpdates（只更新用户修改的字段）
  // 4. 序列化为 YAML 写回文件
  return { success: boolean; error?: string };
});
```

#### `search`

```typescript
// renderer → main
ipcMain.handle('search', async (_event, input: {
  query: string;
  keyword?: string;
  scope: string[];
  top_k?: number;
}) => {
  // 复用 mcp-server/src/tools/search.ts 中的搜索逻辑
  // 初始化搜索服务（懒加载、单例）
  // 调用 search(input) 返回结果
  return {
    results: Array<{
      chunk_id: string;
      score: number;
      content: string;
      summary: string;
      source: { file_path: string; locator: string };
    }>;
    meta: { total_searched: number; fusion_method: string; elapsed_ms: number };
  };
});
```

## 5. 组件结构

### 5.1 文件结构

```
packages/electron-app/src/renderer/
├── App.tsx                    # 根组件（布局容器）
├── main.tsx                   # React 入口
├── index.css                  # 全局样式 + Tailwind
├── index.html                 # HTML 模板
├── components/
│   ├── ui/                    # shadcn/ui 组件（按需引入）
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── dialog.tsx
│   │   ├── badge.tsx
│   │   ├── card.tsx
│   │   ├── tabs.tsx
│   │   ├── textarea.tsx
│   │   ├── select.tsx
│   │   ├── scroll-area.tsx
│   │   ├── separator.tsx
│   │   ├── tooltip.tsx
│   │   └── alert-dialog.tsx
│   ├── Sidebar.tsx            # 侧边栏容器
│   ├── ProjectCard.tsx        # 项目卡片
│   ├── ProjectSummaryEditor.tsx # 描述查看/编辑组件
│   ├── SettingsDialog.tsx     # 设置对话框
│   ├── SearchPanel.tsx        # 搜索主面板
│   ├── SearchScopeSelector.tsx # 搜索范围标签选择器
│   ├── SearchResultCard.tsx   # 搜索结果卡片
│   ├── IndexProgress.tsx      # 索引进度条
│   └── StatusBar.tsx          # 底部状态栏
├── hooks/
│   ├── useRegistry.ts         # registry 数据加载与刷新
│   ├── useConfig.ts           # 配置加载与保存
│   ├── useSearch.ts           # 搜索状态管理
│   └── useIndexing.ts         # 索引状态与进度管理
└── lib/
    └── utils.ts               # 工具函数（cn, formatTime 等）
```

### 5.2 组件层级

```
App
├── Header（标题 + 设置按钮）
│   └── SettingsDialog
├── Sidebar
│   ├── ProjectCard × N
│   │   ├── ProjectSummaryEditor
│   │   └── IndexProgress（更新时显示）
│   └── AddDirectoryButton
├── SearchPanel
│   ├── SearchInput
│   ├── SearchScopeSelector
│   └── SearchResultCard × N
└── StatusBar
```

### 5.3 关键组件 Props

```typescript
// ProjectCard
interface ProjectCardProps {
  project: RegisteredProject;
  isUpdating: boolean;
  progress: IndexProgress | null;
  onUpdate: (projectId: string) => void;
  onRemove: (projectId: string) => void;
  onSummaryChange: (projectId: string, summary: string) => void;
}

// SearchPanel
interface SearchPanelProps {
  projects: RegisteredProject[];  // 用于范围选择
}

// SearchResultCard
interface SearchResultCardProps {
  result: {
    chunk_id: string;
    score: number;
    content: string;
    summary: string;
    source: { file_path: string; locator: string };
  };
  keyword?: string;  // 用于高亮
}

// SettingsDialog
interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

## 6. 后端改动

### 6.1 搜索服务复用

当前搜索逻辑完整实现在 `packages/mcp-server/src/tools/search.ts`。需要将其核心逻辑抽取为可复用模块。

**方案**：将搜索逻辑提取到 `packages/search/` 中的一个新入口函数，同时供 mcp-server 和 electron-app 调用。

具体来说，在 `packages/search/src/` 中新增 `search-service.ts`：

```typescript
// packages/search/src/search-service.ts
export class SearchService {
  private embeddingService: EmbeddingService;
  private vectorStore: VectorStore;
  private invertedIndex: InvertedIndex;

  async init(config: Config): Promise<void>;
  async search(input: SearchInput): Promise<SearchResponse>;
  async dispose(): Promise<void>;
}
```

或者更简单的方案：Electron 主进程直接动态导入并调用 mcp-server 中的搜索函数（与 indexer 类似的模式）。考虑到当前项目阶段，**优先采用直接复用方案**——在 electron main 中 import mcp-server 的搜索模块。

### 6.2 项目移除逻辑

需要新增的清理步骤：

1. **删除 .fs_index 目录**：`rm -rf {project.path}/.fs_index/`
2. **删除全局向量索引**：使用 `VectorStore.deleteByDirId(projectId)` + 遍历子目录 `deleteByDirId(subdirectory.dirId)`
3. **删除全局倒排索引**：使用 `InvertedIndex.removeDirectory(projectId)` + 遍历子目录
4. **更新 registry.json**：移除对应 project 条目

### 6.3 配置保存逻辑

当前 `@agent-fs/core` 只有 `loadConfig()`，没有保存函数。需要新增：

```typescript
// packages/core/src/config/writer.ts
export function saveConfig(updates: Partial<Config>, configPath?: string): void {
  // 1. 读取原始 YAML 文本
  // 2. 解析为对象
  // 3. 深度合并 updates
  // 4. 序列化为 YAML
  // 5. 写入文件
}
```

环境变量处理策略：
- 读取时检测值是否为 `${...}` 格式
- 如果用户未修改该字段，保留原始 `${...}` 引用
- 如果用户修改了该字段，替换为新值（覆盖环境变量引用）

## 7. 依赖变更

### 7.1 新增 dependencies

```json
{
  "dependencies": {
    "@agent-fs/core": "workspace:*",
    "@agent-fs/indexer": "workspace:*",
    "@agent-fs/search": "workspace:*",       // 新增：搜索能力
    "@agent-fs/llm": "workspace:*",          // 新增：embedding 服务
    "@agent-fs/storage": "workspace:*"       // 新增：AFD 存储读取
  }
}
```

### 7.2 新增 devDependencies

```json
{
  "devDependencies": {
    "@radix-ui/react-dialog": "^1.0.0",
    "@radix-ui/react-select": "^2.0.0",
    "@radix-ui/react-tabs": "^1.0.0",
    "@radix-ui/react-tooltip": "^1.0.0",
    "@radix-ui/react-alert-dialog": "^1.0.0",
    "@radix-ui/react-scroll-area": "^1.0.0",
    "@radix-ui/react-separator": "^1.0.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.0.0",
    "tailwind-merge": "^2.0.0",
    "lucide-react": "^0.300.0",
    "js-yaml": "^4.1.0",
    "@types/js-yaml": "^4.0.0"
  }
}
```

## 8. 实施步骤

### Phase 1: 基础设施（预计改动 5 个文件）

1. 安装 shadcn/ui 相关依赖
2. 配置 `tailwind.config.js` 支持 shadcn/ui 的 CSS 变量
3. 创建 `lib/utils.ts`（cn 函数）
4. 引入所需的 shadcn/ui 组件到 `components/ui/`

### Phase 2: 侧边栏 + 项目管理（预计改动 8 个文件）

1. 重构 `App.tsx` 为侧边栏 + 主内容区布局
2. 实现 `Sidebar.tsx` + `ProjectCard.tsx`
3. 实现 `ProjectSummaryEditor.tsx`（描述查看/编辑）
4. 后端新增 IPC：`remove-project`、`update-project-summary`
5. 实现移除确认对话框
6. 复用现有 `start-indexing` 实现增量更新
7. 提取 `IndexProgress.tsx` 组件
8. 更新 `preload/index.ts` 暴露新 IPC

### Phase 3: 设置面板（预计改动 4 个文件）

1. 在 `@agent-fs/core` 中新增 `saveConfig()` 函数
2. 后端新增 IPC：`get-config`、`save-config`
3. 实现 `SettingsDialog.tsx`
4. 更新 `preload/index.ts`

### Phase 4: 搜索功能（预计改动 6 个文件）

1. 后端新增 IPC：`search`（复用 mcp-server 搜索逻辑）
2. 实现 `SearchPanel.tsx`
3. 实现 `SearchScopeSelector.tsx`
4. 实现 `SearchResultCard.tsx`（含关键词高亮）
5. 实现 `useSearch.ts` hook
6. 更新 `preload/index.ts`

### Phase 5: 状态栏 + 打磨（预计改动 3 个文件）

1. 实现 `StatusBar.tsx`
2. 统一错误处理和 toast 提示
3. 响应式布局调整和样式优化

## 9. 技术决策记录

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 布局方案 | 侧边栏/Tab/纵向 | **侧边栏** | 信息密度高，同时看到项目列表和搜索结果 |
| 设置交互 | 模态框/抽屉/独立页 | **模态框** | 简单直接，配置项不多 |
| 搜索范围 | 标签/下拉/联动 | **标签多选** | 直观，一眼看到所有可选范围 |
| UI 组件库 | shadcn/Tailwind/AntD | **shadcn/ui** | 与现有 Tailwind 兼容，按需引入 |
| 移除行为 | 删 .fs_index/仅 registry | **同时删除** | 彻底清理，避免残留 |
| 搜索结果 | 简洁/完整/可展开 | **完整信息** | 提供类似 MCP 的完整返回视图 |
| 搜索服务复用 | 抽取到 search 包/直接导入 mcp-server | **直接导入** | 项目初期，简单优先 |

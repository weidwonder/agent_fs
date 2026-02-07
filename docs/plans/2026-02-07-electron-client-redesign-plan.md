# Electron 客户端改造 — 实施计划

> 设计文档：`docs/plans/2026-02-07-electron-client-redesign.md`
> 日期：2026-02-07

---

## 风险评估

| 风险 | 等级 | 缓解方案 |
|------|------|----------|
| shadcn/ui 与 electron-vite 集成 | 中 | Phase 1 先验证一个 Button 组件能正常渲染 |
| 搜索服务在 Electron main 中初始化慢 | 低 | 懒加载 + 单例，首次搜索时才初始化 |
| 移除项目删除全局向量/倒排数据 | 中 | 先删 registry 再删存储，失败时仍能重试 |
| config.yaml 保存时破坏环境变量引用 | 中 | 保存前对比原始值，未修改字段保留原文 |
| electron.vite.config.ts 的 external 需要新增搜索相关 native 包 | 中 | Phase 4 搜索步骤中显式处理 |

---

## Phase 1: 基础设施搭建

> 目标：安装依赖、配置 shadcn/ui、验证组件可用

### Step 1.1: 安装 shadcn/ui 基础依赖

**操作**：在 `packages/electron-app/` 下安装依赖

```bash
cd packages/electron-app
pnpm add clsx tailwind-merge class-variance-authority lucide-react
pnpm add @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-tabs \
         @radix-ui/react-tooltip @radix-ui/react-alert-dialog \
         @radix-ui/react-scroll-area @radix-ui/react-separator
```

**文件变更**：`packages/electron-app/package.json`

### Step 1.2: 配置 Tailwind CSS 变量

**修改文件**：`packages/electron-app/tailwind.config.js`

变更内容：
- 添加 shadcn/ui 所需的 CSS 变量映射（`--background`, `--foreground`, `--card`, `--primary` 等）
- 使用 stone 色系映射到 CSS 变量
- 添加 `darkMode: 'class'`（预留）
- 添加 `tailwindcss-animate` 插件（shadcn/ui 动画依赖）

**修改文件**：`packages/electron-app/src/renderer/index.css`

变更内容：
- 在 `@layer base` 中定义 CSS 变量（`:root` 下的 HSL 颜色值）

### Step 1.3: 创建工具函数

**新建文件**：`packages/electron-app/src/renderer/lib/utils.ts`

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### Step 1.4: 引入基础 UI 组件

**新建文件**（从 shadcn/ui 源码复制，适配本项目路径）：

- `components/ui/button.tsx`
- `components/ui/input.tsx`
- `components/ui/badge.tsx`
- `components/ui/card.tsx`
- `components/ui/separator.tsx`
- `components/ui/scroll-area.tsx`
- `components/ui/tooltip.tsx`

### Step 1.5: 验证检查点

**验证**：修改 `App.tsx`，用 shadcn Button 替换现有按钮，确认 `pnpm dev` 能正常运行和渲染。

---

## Phase 2: 侧边栏 + 项目管理

> 目标：左侧侧边栏显示项目列表，支持描述编辑、移除、增量更新

### Step 2.1: 重构 App.tsx 布局

**修改文件**：`packages/electron-app/src/renderer/App.tsx`

变更内容：
- 从单列布局改为 flex 两栏：左侧 `Sidebar`（280px）+ 右侧 `main`（flex-1）
- 顶部 header 横跨两栏，右侧放设置按钮（占位，Phase 3 实现）
- 底部 StatusBar（占位，Phase 5 实现）
- 将现有的项目列表逻辑抽取到 Sidebar 组件

### Step 2.2: 提取 hooks

**新建文件**：

`packages/electron-app/src/renderer/hooks/useRegistry.ts`
```typescript
// 从 App.tsx 中提取 registry 加载逻辑
// 提供：projects, loadRegistry, isLoading
```

`packages/electron-app/src/renderer/hooks/useIndexing.ts`
```typescript
// 从 App.tsx 中提取索引相关逻辑
// 提供：indexing, progress, startIndexing(dirPath), indexingProjectPath
// 支持追踪当前正在索引的 projectPath（用于在 ProjectCard 上显示进度）
```

### Step 2.3: 实现 Sidebar + ProjectCard

**新建文件**：`packages/electron-app/src/renderer/components/Sidebar.tsx`

```
Sidebar
├── ScrollArea（项目列表可滚动）
│   └── ProjectCard × N
└── AddDirectoryButton（底部固定）
```

**新建文件**：`packages/electron-app/src/renderer/components/ProjectCard.tsx`

显示内容：
- `alias` 作为标题
- `path` 灰色小字（tooltip 显示完整路径）
- `totalFileCount` 文件 · `totalChunkCount` chunks（Badge）
- `lastUpdated` 相对时间
- `summary` 2 行截断
- 操作按钮：更新（RefreshCw 图标）、删除（Trash2 图标）
- 更新中时显示进度条（复用现有进度逻辑）

### Step 2.4: 实现 ProjectSummaryEditor

**新建文件**：`packages/electron-app/src/renderer/components/ProjectSummaryEditor.tsx`

三个状态：
1. **收起**：2 行截断，点击展开
2. **展开**：全文显示 + "编辑"按钮
3. **编辑**：textarea + 保存/取消按钮

### Step 2.5: 后端 IPC — update-project-summary

**修改文件**：`packages/electron-app/src/main/index.ts`

新增 handler：
```typescript
ipcMain.handle('update-project-summary', async (_event, projectId: string, newSummary: string) => {
  // 读取 registry.json → 找到 project → 更新 summary → 写回
});
```

**修改文件**：`packages/electron-app/src/preload/index.ts`

新增暴露：
```typescript
updateProjectSummary: (projectId: string, summary: string) =>
  ipcRenderer.invoke('update-project-summary', projectId, summary),
```

### Step 2.6: 实现移除项目功能

**引入 UI 组件**：`components/ui/alert-dialog.tsx`

**修改文件**：`packages/electron-app/src/main/index.ts`

新增 `remove-project` handler：
1. 读取 `registry.json`，找到目标 project
2. 收集所有 dirId（projectId + subdirectories 的 dirId）
3. 删除 `{project.path}/.fs_index/`（`rm -rf`）
4. 初始化 VectorStore，逐个调用 `deleteByDirId(dirId)`
5. 初始化 InvertedIndex，逐个调用 `removeDirectory(dirId)`
6. 从 `registry.projects` 中过滤掉该项目
7. 写回 `registry.json`
8. 关闭 VectorStore 和 InvertedIndex

**修改文件**：`packages/electron-app/src/preload/index.ts`

**修改文件**：`packages/electron-app/src/renderer/App.tsx`（或 `Sidebar.tsx`）
- ProjectCard 删除按钮 → 弹出 AlertDialog → 确认后调用 IPC → 刷新 registry

**修改文件**：`packages/electron-app/electron.vite.config.ts`
- 在 `main.build.rollupOptions.external` 中新增 `@agent-fs/search`、`better-sqlite3`（搜索和倒排索引的 native 依赖）

### Step 2.7: 增量更新

已有 `start-indexing` IPC，只需在 ProjectCard 上接入：
- 点击更新按钮 → 调用 `startIndexing(project.path)`
- `useIndexing` hook 追踪 `indexingProjectPath`
- 对应的 ProjectCard 显示进度条

### Step 2.8: 提取 IndexProgress 组件

**新建文件**：`packages/electron-app/src/renderer/components/IndexProgress.tsx`

从 App.tsx 中提取现有进度条 UI，独立为组件，同时用于 Sidebar 中的 ProjectCard 和全局 StatusBar。

### Step 2.9: 验证检查点

**验证**：
1. `pnpm dev` 启动，侧边栏正确显示已有项目
2. 点击描述可展开/编辑/保存
3. 点击删除按钮弹出确认框，确认后项目从列表消失，`.fs_index` 被删除
4. 点击更新按钮开始增量索引，进度条正常显示
5. 点击"添加目录"可选择新文件夹并开始索引

---

## Phase 3: 设置面板

> 目标：右上角设置按钮，模态对话框编辑 config.yaml

### Step 3.1: 后端 — config 读写

**新建文件**：`packages/core/src/config/writer.ts`

```typescript
export interface RawConfigResult {
  rawConfig: Record<string, unknown>;       // YAML 原始解析（含 ${VAR} 占位符）
  resolvedConfig: Record<string, unknown>;  // 环境变量已解析
  envFields: string[];                      // 来自环境变量的字段路径
}

export function readRawConfig(configPath?: string): RawConfigResult;
export function saveConfig(updates: Record<string, unknown>, configPath?: string): void;
```

**实现细节**：
- `readRawConfig`：读取 YAML 文本 → 解析为对象（rawConfig）→ 调用 `resolveEnvVariables` 得到 resolvedConfig → 递归对比提取 envFields
- `saveConfig`：读取原始 YAML 对象 → 深度合并 updates（只覆盖非 `undefined` 字段）→ `js-yaml.dump()` → 写入文件
- 环境变量字段保护：如果 updates 中某字段值等于 resolvedConfig 中的值，说明用户未修改，保留 rawConfig 中的 `${VAR}` 原文

**修改文件**：`packages/core/src/config/index.ts`（导出新函数）

**修改文件**：`packages/core/package.json`（确认 `js-yaml` 已在依赖中）

### Step 3.2: 后端 IPC — get-config / save-config

**修改文件**：`packages/electron-app/src/main/index.ts`

```typescript
ipcMain.handle('get-config', async () => {
  const { readRawConfig } = await import('@agent-fs/core');
  return readRawConfig();
});

ipcMain.handle('save-config', async (_event, updates: Record<string, unknown>) => {
  const { saveConfig } = await import('@agent-fs/core');
  saveConfig(updates);
  return { success: true };
});
```

**修改文件**：`packages/electron-app/src/preload/index.ts`

### Step 3.3: 引入 UI 组件

**新建文件**：
- `components/ui/dialog.tsx`
- `components/ui/tabs.tsx`
- `components/ui/select.tsx`
- `components/ui/textarea.tsx`

### Step 3.4: 实现 SettingsDialog

**新建文件**：`packages/electron-app/src/renderer/components/SettingsDialog.tsx`

**新建文件**：`packages/electron-app/src/renderer/hooks/useConfig.ts`

```typescript
// 提供：config, envFields, isLoading, saveConfig(updates), isSaving
```

SettingsDialog 内部结构：
```
Dialog
├── DialogHeader "设置"
├── Tabs
│   ├── Tab "LLM" → LLM 配置表单
│   ├── Tab "Embedding" → Embedding 配置表单（条件显示 local/api）
│   ├── Tab "摘要" → Summary 配置表单
│   ├── Tab "索引 & 搜索" → Indexing + Search 配置表单
│   └── Tab "插件" → Plugins 配置表单
└── DialogFooter
    ├── 取消按钮
    └── 保存按钮
```

每个字段旁如果来自环境变量（在 `envFields` 列表中），显示一个小标签 "ENV"。

### Step 3.5: App.tsx 集成设置按钮

**修改文件**：`packages/electron-app/src/renderer/App.tsx`

- header 右侧添加齿轮图标按钮（lucide-react 的 `Settings` 图标）
- 点击打开 SettingsDialog
- 管理 `settingsOpen` 状态

### Step 3.6: 验证检查点

**验证**：
1. 点击设置按钮弹出对话框
2. 各 Tab 正确加载当前配置值
3. 环境变量字段标注 "ENV"
4. 修改 summary.mode 为 skip → 保存 → 重新打开确认已更改
5. 确认 config.yaml 文件中未修改的环境变量引用被保留

---

## Phase 4: 搜索功能

> 目标：主内容区搜索框 + 范围选择 + 卡片式结果展示

### Step 4.1: 后端 IPC — search

**修改文件**：`packages/electron-app/src/main/index.ts`

搜索服务复用方案：从 `@agent-fs/mcp-server` 的 `tools/search.ts` 中直接复制搜索逻辑到 Electron main 中（避免依赖 MCP SDK）。

实际操作：
1. 在 electron main 中实现一个轻量的搜索入口函数
2. 懒加载初始化：首次搜索时创建 embeddingService、vectorStore、invertedIndex 单例
3. 搜索逻辑参考 mcp-server 的 `search()` 函数，包含：
   - 解析 scope → 获取 dirIds 和 fileLookup
   - 三路搜索（content_vector + summary_vector + inverted_index）
   - RRF 融合
   - 内容回填（hydrate）

**修改文件**：`packages/electron-app/electron.vite.config.ts`
- external 新增：`@agent-fs/search`、`@agent-fs/llm`、`@agent-fs/storage`、`@agent-fs/core`、`better-sqlite3`

**修改文件**：`packages/electron-app/package.json`
- dependencies 新增：`@agent-fs/search`、`@agent-fs/llm`、`@agent-fs/storage`

**修改文件**：`packages/electron-app/src/preload/index.ts`

### Step 4.2: 实现 useSearch hook

**新建文件**：`packages/electron-app/src/renderer/hooks/useSearch.ts`

```typescript
interface UseSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  keyword: string;
  setKeyword: (k: string) => void;
  selectedScopes: string[];       // 选中的项目 path 数组
  toggleScope: (path: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  results: SearchResult[] | null;
  meta: SearchMeta | null;
  isSearching: boolean;
  search: () => Promise<void>;
}
```

### Step 4.3: 实现 SearchScopeSelector

**新建文件**：`packages/electron-app/src/renderer/components/SearchScopeSelector.tsx`

- 接收 `projects` 列表和 `selectedScopes`
- 每个项目渲染一个可点击的 Badge（alias）
- 选中状态用颜色区分（selected: stone-800 背景白字，unselected: stone-200 背景灰字）
- "全选 / 取消" 快捷操作

### Step 4.4: 实现 SearchPanel

**新建文件**：`packages/electron-app/src/renderer/components/SearchPanel.tsx`

结构：
```
div.flex-1.flex.flex-col
├── div.search-header
│   ├── Input（query，placeholder="语义搜索..."）
│   ├── Input（keyword，placeholder="精确关键词（可选）"，较小尺寸）
│   └── Button（搜索）
├── SearchScopeSelector
├── div.search-meta（结果数、耗时、融合方法）
└── ScrollArea.flex-1
    └── SearchResultCard × N
```

### Step 4.5: 实现 SearchResultCard

**新建文件**：`packages/electron-app/src/renderer/components/SearchResultCard.tsx`

卡片内容：
- 顶部：score badge（颜色梯度）+ chunk_id 小字
- 摘要区：summary 文本
- 正文区：content 文本，对 query/keyword 做关键词高亮（将匹配文本包裹在 `<mark>` 中）
- 底部：file_path（可点击复制）+ locator

**高亮实现**：
```typescript
function highlightText(text: string, keywords: string[]): React.ReactNode {
  // 将 keywords 构建为正则，split 文本，匹配部分用 <mark> 包裹
}
```

### Step 4.6: App.tsx 集成搜索面板

**修改文件**：`packages/electron-app/src/renderer/App.tsx`

- 右侧主内容区渲染 `<SearchPanel projects={projects} />`
- 搜索面板在没有项目时显示空状态提示

### Step 4.7: 验证检查点

**验证**：
1. 搜索框输入查询，回车后触发搜索
2. 搜索范围标签正确显示所有项目，可点击选择/取消
3. 搜索结果以卡片形式展示，包含 score、summary、content（高亮）、source
4. 搜索元信息（耗时、数量）正确显示
5. 无项目时显示空状态

---

## Phase 5: 状态栏 + 打磨

> 目标：底部状态栏、错误处理、样式优化

### Step 5.1: 实现 StatusBar

**新建文件**：`packages/electron-app/src/renderer/components/StatusBar.tsx`

显示内容（互斥）：
- 索引中：当前阶段 + 文件名 + 进度百分比
- 搜索完成：耗时 + 结果数量
- 空闲：项目总数 + 总文件数

### Step 5.2: 错误处理

**修改文件**：各组件

- 搜索失败：SearchPanel 中显示内联错误提示
- 移除失败：AlertDialog 中显示错误信息
- 配置保存失败：SettingsDialog 中显示错误信息
- 索引失败：StatusBar + ProjectCard 中显示错误状态

### Step 5.3: 样式优化

**修改文件**：`index.css`、各组件

- 侧边栏与主内容区之间的分隔线
- 搜索结果卡片 hover 效果
- 空状态插图/文案
- 加载状态（skeleton / spinner）
- 确保窗口最小尺寸下布局不崩溃

### Step 5.4: 最终验证

**全流程验证**：
1. 启动应用 → 侧边栏显示已有项目
2. 添加新目录 → 索引完成 → 项目出现在列表中
3. 编辑项目描述 → 保存成功
4. 搜索已索引内容 → 结果正确展示
5. 修改设置（如 summary mode）→ 保存成功 → config.yaml 更新
6. 移除项目 → 确认后删除成功 → .fs_index 被清理
7. 搜索时选择不同范围 → 结果只来自选中的项目

---

## 文件变更清单

### 新建文件（约 18 个）

| 文件 | Phase |
|------|-------|
| `renderer/lib/utils.ts` | 1 |
| `renderer/components/ui/button.tsx` | 1 |
| `renderer/components/ui/input.tsx` | 1 |
| `renderer/components/ui/badge.tsx` | 1 |
| `renderer/components/ui/card.tsx` | 1 |
| `renderer/components/ui/separator.tsx` | 1 |
| `renderer/components/ui/scroll-area.tsx` | 1 |
| `renderer/components/ui/tooltip.tsx` | 1 |
| `renderer/components/ui/alert-dialog.tsx` | 2 |
| `renderer/components/Sidebar.tsx` | 2 |
| `renderer/components/ProjectCard.tsx` | 2 |
| `renderer/components/ProjectSummaryEditor.tsx` | 2 |
| `renderer/components/IndexProgress.tsx` | 2 |
| `renderer/hooks/useRegistry.ts` | 2 |
| `renderer/hooks/useIndexing.ts` | 2 |
| `renderer/components/ui/dialog.tsx` | 3 |
| `renderer/components/ui/tabs.tsx` | 3 |
| `renderer/components/ui/select.tsx` | 3 |
| `renderer/components/ui/textarea.tsx` | 3 |
| `renderer/components/SettingsDialog.tsx` | 3 |
| `renderer/hooks/useConfig.ts` | 3 |
| `core/src/config/writer.ts` | 3 |
| `renderer/components/SearchPanel.tsx` | 4 |
| `renderer/components/SearchScopeSelector.tsx` | 4 |
| `renderer/components/SearchResultCard.tsx` | 4 |
| `renderer/hooks/useSearch.ts` | 4 |
| `renderer/components/StatusBar.tsx` | 5 |

### 修改文件（约 8 个）

| 文件 | Phase | 变更内容 |
|------|-------|----------|
| `electron-app/package.json` | 1, 4 | 新增依赖 |
| `electron-app/tailwind.config.js` | 1 | shadcn/ui CSS 变量 |
| `electron-app/src/renderer/index.css` | 1 | CSS 变量定义 |
| `electron-app/src/renderer/App.tsx` | 2, 3, 4, 5 | 布局重构 + 集成各模块 |
| `electron-app/src/main/index.ts` | 2, 3, 4 | 新增 5 个 IPC handler |
| `electron-app/src/preload/index.ts` | 2, 3, 4 | 暴露新 IPC |
| `electron-app/electron.vite.config.ts` | 2, 4 | external 新增依赖 |
| `core/src/config/index.ts` | 3 | 导出 writer |

---

## 执行顺序与依赖

```
Phase 1 (基础设施)
  │
  ├── Phase 2 (侧边栏) ─── Phase 3 (设置面板)
  │                              │
  └──────────── Phase 4 (搜索) ──┘
                    │
              Phase 5 (打磨)
```

- Phase 2 和 Phase 3 互不依赖，可并行开发
- Phase 4 依赖 Phase 2（需要项目列表作为搜索范围来源）
- Phase 5 依赖所有前置 Phase

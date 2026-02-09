# P0 Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现三个 P0 功能：txt 文件支持、项目 memory 系统、召回准确率评测

**Architecture:** P0-1 在 MarkdownPlugin 扩展名列表加 txt；P0-2 新增 MCP 工具 `get_project_memory` + Electron memory 编辑 UI + indexer 跳过 memory 目录；P0-3 构建评测脚本和数据集

**Tech Stack:** TypeScript, Vitest, MCP SDK, Electron IPC, React

---

## Task 1: MarkdownPlugin 支持 .txt 扩展名

**Files:**
- Modify: `packages/plugins/plugin-markdown/src/plugin.ts:17`
- Modify: `packages/plugins/plugin-markdown/src/plugin.test.ts`

**Step 1: 写测试 — txt 扩展名支持**

在 `packages/plugins/plugin-markdown/src/plugin.test.ts` 的 `describe('properties')` 块中添加：

```typescript
it('should support txt extension', () => {
  expect(plugin.supportedExtensions).toContain('txt');
});
```

在 `describe('toMarkdown')` 块末尾添加：

```typescript
it('should handle .txt file like markdown', async () => {
  const content = 'Plain text content\n\nSecond paragraph.';
  const filePath = join(testDir, 'readme.txt');
  writeFileSync(filePath, content);

  const result = await plugin.toMarkdown(filePath);
  expect(result.markdown).toBe(content);
  expect(result.mapping.length).toBe(2);
});
```

**Step 2: 运行测试验证失败**

Run: `cd /Users/weidwonder/projects/agent_fs && pnpm --filter @agent-fs/plugin-markdown test`
Expected: FAIL — `supportedExtensions` 不包含 `'txt'`

**Step 3: 实现 — 添加 txt 扩展名**

在 `packages/plugins/plugin-markdown/src/plugin.ts:17`，将：

```typescript
readonly supportedExtensions = ['md', 'markdown'];
```

改为：

```typescript
readonly supportedExtensions = ['md', 'markdown', 'txt'];
```

**Step 4: 运行测试验证通过**

Run: `cd /Users/weidwonder/projects/agent_fs && pnpm --filter @agent-fs/plugin-markdown test`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/plugins/plugin-markdown/src/plugin.ts packages/plugins/plugin-markdown/src/plugin.test.ts
git commit -m "feat(plugin-markdown): support .txt file extension"
```

---

## Task 2: Scanner 排除 memory 目录

**Files:**
- Modify: `packages/indexer/src/scanner.ts:21`
- 无需新增测试（scanner 已有跳过隐藏文件的逻辑，memory 在 .fs_index 内，.fs_index 是隐藏目录已被跳过）

**分析：** `.fs_index` 以 `.` 开头，`scanner.ts:21` 的 `if (entry.startsWith('.')) continue;` 已经跳过了整个 `.fs_index` 目录。memory 在 `.fs_index/memory/` 下，不会被扫描到。**无需改动 scanner。**

> 此 Task 经分析无需代码改动，跳过。

---

## Task 3: MCP 工具 — get_project_memory

**Files:**
- Create: `packages/mcp-server/src/tools/get-project-memory.ts`
- Modify: `packages/mcp-server/src/server.ts`

**Step 1: 创建 get-project-memory 工具**

创建 `packages/mcp-server/src/tools/get-project-memory.ts`：

```typescript
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Registry } from '@agent-fs/core';

interface MemoryFileInfo {
  path: string;
  size: number;
}

interface GetProjectMemoryInput {
  project: string; // projectId 或 projectPath
}

interface GetProjectMemoryResult {
  memoryPath: string;
  exists: boolean;
  projectMd: string;
  files: MemoryFileInfo[];
}

function findProjectPath(projectIdentifier: string): string | null {
  const registryPath = join(homedir(), '.agent_fs', 'registry.json');
  if (!existsSync(registryPath)) return null;

  const registry = JSON.parse(readFileSync(registryPath, 'utf-8')) as Registry;
  if (!Array.isArray(registry.projects)) return null;

  // 先按 projectId 匹配
  const byId = registry.projects.find((p) => p.projectId === projectIdentifier);
  if (byId) return byId.path;

  // 再按 path 匹配
  const byPath = registry.projects.find((p) => p.path === projectIdentifier);
  if (byPath) return byPath.path;

  return null;
}

function collectFiles(dir: string, prefix: string): MemoryFileInfo[] {
  if (!existsSync(dir)) return [];

  const result: MemoryFileInfo[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;
    const stat = statSync(fullPath);

    if (stat.isFile() && entry.endsWith('.md')) {
      result.push({ path: relativePath, size: stat.size });
    } else if (stat.isDirectory()) {
      result.push(...collectFiles(fullPath, relativePath));
    }
  }
  return result;
}

export async function getProjectMemory(
  input: GetProjectMemoryInput
): Promise<GetProjectMemoryResult> {
  const projectPath = findProjectPath(input.project);
  if (!projectPath) {
    throw new Error(`项目不存在: ${input.project}`);
  }

  const memoryPath = join(projectPath, '.fs_index', 'memory');
  const projectMdPath = join(memoryPath, 'project.md');

  const exists = existsSync(memoryPath);
  const projectMd = existsSync(projectMdPath)
    ? readFileSync(projectMdPath, 'utf-8')
    : '';

  const files = collectFiles(memoryPath, '');

  return { memoryPath, exists, projectMd, files };
}
```

**Step 2: 在 server.ts 注册工具**

在 `packages/mcp-server/src/server.ts` 顶部 import 区域添加：

```typescript
import { getProjectMemory } from './tools/get-project-memory.js';
```

在 `ListToolsRequestSchema` handler 的 `tools` 数组末尾添加：

```typescript
{
  name: 'get_project_memory',
  description: '获取项目的 memory 目录信息和内容。返回 memoryPath（绝对路径）供读写文件，以及 project.md 内容和文件列表。',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'projectId 或项目路径' },
    },
    required: ['project'],
  },
},
```

在 `CallToolRequestSchema` handler 的 switch 中添加：

```typescript
case 'get_project_memory':
  return { content: [{ type: 'text', text: JSON.stringify(await getProjectMemory(args as any)) }] };
```

**Step 3: 编译验证**

Run: `cd /Users/weidwonder/projects/agent_fs && pnpm --filter @agent-fs/mcp-server build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add packages/mcp-server/src/tools/get-project-memory.ts packages/mcp-server/src/server.ts
git commit -m "feat(mcp): add get_project_memory tool"
```

---

## Task 4: Indexer — 索引完成后自动生成 project.md 初始内容

**Files:**
- Modify: `packages/indexer/src/indexer.ts`

**Step 1: 在 indexDirectory 方法中，updateRegistry 之前添加 memory 初始化**

在 `packages/indexer/src/indexer.ts` 的 `indexDirectory` 方法中，在 `this.updateRegistry(metadata);`（约第 96 行）之前添加：

```typescript
// 若 memory/project.md 不存在，基于 directorySummary 自动生成初始版本
this.initMemoryIfNeeded(dirPath, metadata);
```

在类中添加私有方法：

```typescript
private initMemoryIfNeeded(dirPath: string, metadata: IndexMetadata): void {
  const memoryDir = join(dirPath, '.fs_index', 'memory');
  const projectMdPath = join(memoryDir, 'project.md');

  if (existsSync(projectMdPath)) return;
  if (!metadata.directorySummary) return;

  mkdirSync(memoryDir, { recursive: true });
  mkdirSync(join(memoryDir, 'extend'), { recursive: true });

  const content = `# ${metadata.directoryPath.split('/').pop() || 'Project'}\n\n${metadata.directorySummary}\n`;
  writeFileSync(projectMdPath, content);
}
```

**Step 2: 编译验证**

Run: `cd /Users/weidwonder/projects/agent_fs && pnpm --filter @agent-fs/indexer build`
Expected: 编译成功

**Step 3: Commit**

```bash
git add packages/indexer/src/indexer.ts
git commit -m "feat(indexer): auto-generate memory/project.md on first index"
```

---

## Task 5: Electron — Memory IPC handler

**Files:**
- Modify: `packages/electron-app/src/main/index.ts`
- Modify: `packages/electron-app/src/preload/index.ts`
- Modify: `packages/electron-app/src/renderer/types/electron.d.ts`

**Step 1: 在 main/index.ts 添加 memory IPC handlers**

在 `packages/electron-app/src/main/index.ts` 的 IPC handlers 区域（`// --- IPC: Config ---` 之前）添加：

```typescript
// --- IPC: Memory ---

ipcMain.handle('get-project-memory', async (_event, projectId: string) => {
  try {
    const registry = readRegistry();
    const project = registry.projects.find((p: any) => p.projectId === projectId);
    if (!project) {
      return { memoryPath: '', exists: false, projectMd: '', files: [] };
    }

    const memoryPath = join(project.path, '.fs_index', 'memory');
    const projectMdPath = join(memoryPath, 'project.md');

    const memoryExists = existsSync(memoryPath);
    const projectMd = existsSync(projectMdPath)
      ? readFileSync(projectMdPath, 'utf-8')
      : '';

    // 递归收集 memory 目录下的 .md 文件
    const files: { path: string; size: number }[] = [];
    const collectFiles = (dir: string, prefix: string) => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        const relativePath = prefix ? `${prefix}/${entry}` : entry;
        if (stat.isFile() && entry.endsWith('.md')) {
          files.push({ path: relativePath, size: stat.size });
        } else if (stat.isDirectory()) {
          collectFiles(fullPath, relativePath);
        }
      }
    };
    collectFiles(memoryPath, '');

    return { memoryPath, exists: memoryExists, projectMd, files };
  } catch (error) {
    return { memoryPath: '', exists: false, projectMd: '', files: [], error: (error as Error).message };
  }
});

ipcMain.handle('save-memory-file', async (_event, projectId: string, filePath: string, content: string) => {
  try {
    const registry = readRegistry();
    const project = registry.projects.find((p: any) => p.projectId === projectId);
    if (!project) {
      return { success: false, error: '项目不存在' };
    }

    const memoryDir = join(project.path, '.fs_index', 'memory');
    const fullPath = join(memoryDir, filePath);

    // 安全检查：确保路径在 memory 目录内
    if (!resolve(fullPath).startsWith(resolve(memoryDir))) {
      return { success: false, error: '路径越界' };
    }

    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content);
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});
```

注意：需要在文件顶部的 import 中确认 `readdirSync`, `statSync`, `resolve` 已被导入。当前已有 `readFileSync, writeFileSync, existsSync, rmSync, mkdirSync`，需要添加 `readdirSync, statSync`。`resolve` 已在 path import 中。

**Step 2: 在 preload/index.ts 暴露 memory API**

在 `packages/electron-app/src/preload/index.ts` 的 `contextBridge.exposeInMainWorld` 对象中添加：

```typescript
// Memory
getProjectMemory: (projectId: string) => ipcRenderer.invoke('get-project-memory', projectId),
saveMemoryFile: (projectId: string, filePath: string, content: string) =>
  ipcRenderer.invoke('save-memory-file', projectId, filePath, content),
```

**Step 3: 更新类型声明**

在 `packages/electron-app/src/renderer/types/electron.d.ts` 中添加：

`ElectronAPI` interface 内添加：

```typescript
getProjectMemory: (projectId: string) => Promise<{
  memoryPath: string;
  exists: boolean;
  projectMd: string;
  files: { path: string; size: number }[];
}>;
saveMemoryFile: (projectId: string, filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
```

**Step 4: 编译验证**

Run: `cd /Users/weidwonder/projects/agent_fs && pnpm --filter @agent-fs/electron-app build`
Expected: 编译成功（或至少 tsc 无类型错误）

**Step 5: Commit**

```bash
git add packages/electron-app/src/main/index.ts packages/electron-app/src/preload/index.ts packages/electron-app/src/renderer/types/electron.d.ts
git commit -m "feat(electron): add memory IPC handlers"
```

---

## Task 6: Electron — Memory 编辑 UI 组件

**Files:**
- Create: `packages/electron-app/src/renderer/components/MemoryEditor.tsx`
- Create: `packages/electron-app/src/renderer/hooks/useMemory.ts`
- Modify: `packages/electron-app/src/renderer/components/ProjectCard.tsx`

**Step 1: 创建 useMemory hook**

创建 `packages/electron-app/src/renderer/hooks/useMemory.ts`：

```typescript
import { useState, useCallback, useEffect } from 'react';

interface MemoryFile {
  path: string;
  size: number;
}

interface MemoryState {
  memoryPath: string;
  exists: boolean;
  projectMd: string;
  files: MemoryFile[];
  loading: boolean;
}

export function useMemory(projectId: string | null) {
  const [state, setState] = useState<MemoryState>({
    memoryPath: '',
    exists: false,
    projectMd: '',
    files: [],
    loading: false,
  });

  const load = useCallback(async () => {
    if (!projectId) return;
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const result = await window.electronAPI.getProjectMemory(projectId);
      setState({ ...result, loading: false });
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async (filePath: string, content: string) => {
    if (!projectId) return;
    const result = await window.electronAPI.saveMemoryFile(projectId, filePath, content);
    if (result.success) {
      await load(); // 刷新
    }
    return result;
  }, [projectId, load]);

  return { ...state, reload: load, save };
}
```

**Step 2: 创建 MemoryEditor 组件**

创建 `packages/electron-app/src/renderer/components/MemoryEditor.tsx`：

```tsx
import React, { useState, useCallback } from 'react';
import { FileText, Save, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import { useMemory } from '../hooks/useMemory';

interface MemoryEditorProps {
  projectId: string;
}

export function MemoryEditor({ projectId }: MemoryEditorProps) {
  const { exists, projectMd, files, loading, save } = useMemory(projectId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleEdit = useCallback(() => {
    setDraft(projectMd);
    setEditing(true);
  }, [projectMd]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    await save('project.md', draft);
    setEditing(false);
    setSaving(false);
  }, [save, draft]);

  if (loading) {
    return <p className="text-xs text-muted-foreground px-1 py-2">加载中...</p>;
  }

  return (
    <div className="space-y-1">
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground w-full text-left cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <FileText className="h-3 w-3" />
        <span>项目记忆{exists ? ` (${files.length} 文件)` : ' (未创建)'}</span>
      </button>

      {expanded && (
        <div className="pl-4 space-y-2">
          {editing ? (
            <div className="space-y-1">
              <textarea
                className="w-full min-h-[120px] text-xs font-mono p-2 border rounded resize-y bg-background"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-6 text-xs cursor-pointer" onClick={handleSave} disabled={saving}>
                  <Save className="h-3 w-3 mr-1" />
                  {saving ? '保存中...' : '保存'}
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-xs cursor-pointer" onClick={() => setEditing(false)}>
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {projectMd ? (
                <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">{projectMd}</p>
              ) : (
                <p className="text-xs text-muted-foreground italic">暂无项目记忆</p>
              )}
              <Button size="sm" variant="ghost" className="h-6 text-xs cursor-pointer" onClick={handleEdit}>
                {exists ? '编辑' : '创建'}
              </Button>
            </div>
          )}

          {files.length > 1 && (
            <>
              <Separator />
              <div className="space-y-0.5">
                {files.filter((f) => f.path !== 'project.md').map((file) => (
                  <p key={file.path} className="text-xs text-muted-foreground truncate">
                    📄 {file.path}
                  </p>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 3: 在 ProjectCard 中集成 MemoryEditor**

阅读 `packages/electron-app/src/renderer/components/ProjectCard.tsx` 并在项目卡片底部（summary 编辑区域之后）添加 `<MemoryEditor projectId={project.projectId} />`。

需要：
```typescript
import { MemoryEditor } from './MemoryEditor';
```

然后在卡片内容区域合适位置添加：
```tsx
<MemoryEditor projectId={project.projectId} />
```

**Step 4: 编译验证**

Run: `cd /Users/weidwonder/projects/agent_fs && pnpm --filter @agent-fs/electron-app build`
Expected: 编译成功

**Step 5: Commit**

```bash
git add packages/electron-app/src/renderer/components/MemoryEditor.tsx packages/electron-app/src/renderer/hooks/useMemory.ts packages/electron-app/src/renderer/components/ProjectCard.tsx
git commit -m "feat(electron): add memory editor UI in project card"
```

---

## Task 7: 更新文档

**Files:**
- Modify: `docs/requirements.md` — 添加 txt 支持和 memory 功能描述
- Modify: `docs/architecture.md` — 添加 memory 存储结构和 MCP 工具说明
- Modify: `.user.idea` — 删除已完成的 P0-1 和 P0-2 条目

**Step 1: 更新 requirements.md**

在 `docs/requirements.md` 的 `### 2.1 文档索引` 表格中，`支持格式` 行改为：

```
| 支持格式 | PDF / DOCX / DOC / XLSX / XLS / Markdown / TXT |
```

在 `## 5. MCP Tools` 表格末尾添加：

```
| `get_project_memory` | 获取项目的 memory 路径、project.md 内容和文件列表 |
```

**Step 2: 更新 architecture.md**

在 `## 7.2 Project 目录（本地索引）` 的目录结构图中添加 memory：

```
<project>/
├── .fs_index/
│   ├── index.json
│   ├── memory/                    # 项目结构记忆（不参与索引）
│   │   ├── project.md             # 项目介绍
│   │   └── extend/                # 扩展经验
│   └── documents/
│       └── ...
```

在 MCP 工具相关章节（如 `## 5` 之后）补充 `get_project_memory` 说明。

**Step 3: 更新 .user.idea**

删除 P0-1 和 P0-2 已完成的行，保留未完成条目。

**Step 4: Commit**

```bash
git add docs/requirements.md docs/architecture.md .user.idea
git commit -m "docs: update requirements and architecture for txt support and memory feature"
```

---

## Task 8: P0-3 召回准确率评测脚本

**Files:**
- Create: `packages/e2e/src/retrieval-eval/eval-dataset.json`
- Create: `packages/e2e/src/retrieval-eval/retrieval-eval.ts`

**Step 1: 创建评测数据集模板**

创建 `packages/e2e/src/retrieval-eval/eval-dataset.json`：

```json
{
  "description": "Agent FS 召回准确率评测数据集",
  "version": "1.0",
  "projectPath": "",
  "queries": [
    {
      "id": "q1",
      "query": "示例语义查询",
      "keyword": "",
      "type": "semantic",
      "expectedChunks": ["chunk_id_1", "chunk_id_2"],
      "expectedFiles": ["file1.md"]
    }
  ]
}
```

> 注意：实际数据需要基于已索引的真实项目手动标注。

**Step 2: 创建评测脚本**

创建 `packages/e2e/src/retrieval-eval/retrieval-eval.ts`：

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig } from '@agent-fs/core';
import { createEmbeddingService } from '@agent-fs/llm';
import { createVectorStore, InvertedIndex, fusionRRF } from '@agent-fs/search';

interface EvalQuery {
  id: string;
  query: string;
  keyword: string;
  type: 'semantic' | 'keyword' | 'hybrid';
  expectedChunks: string[];
  expectedFiles: string[];
}

interface EvalDataset {
  projectPath: string;
  queries: EvalQuery[];
}

interface EvalMetrics {
  queryId: string;
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  hitChunks: string[];
  missedChunks: string[];
}

async function evaluate(datasetPath: string, topK = 10) {
  const dataset: EvalDataset = JSON.parse(readFileSync(datasetPath, 'utf-8'));
  const config = loadConfig();
  const storagePath = join(homedir(), '.agent_fs', 'storage');

  const embeddingService = createEmbeddingService(config.embedding);
  await embeddingService.init();

  const vectorStore = createVectorStore({
    storagePath: join(storagePath, 'vectors'),
    dimension: embeddingService.getDimension(),
  });
  await vectorStore.init();

  const invertedIndex = new InvertedIndex({
    dbPath: join(storagePath, 'inverted-index', 'inverted-index.db'),
  });
  await invertedIndex.init();

  const results: Record<string, EvalMetrics[]> = {
    content_vector: [],
    summary_vector: [],
    inverted_index: [],
    rrf_fusion: [],
  };

  for (const q of dataset.queries) {
    const queryVector = q.query ? await embeddingService.embed(q.query) : null;

    // 各路召回
    const contentHits = queryVector
      ? (await vectorStore.searchByContent(queryVector, { topK })).map((r: any) => r.chunk_id)
      : [];
    const summaryHits = queryVector
      ? (await vectorStore.searchBySummary(queryVector, { topK })).map((r: any) => r.chunk_id)
      : [];
    const keywordHits = q.keyword || q.query
      ? (await invertedIndex.search(q.keyword || q.query, { topK })).map((r: any) => r.chunkId)
      : [];

    // RRF 融合
    const lists = [
      { name: 'content', items: contentHits.map((id: string) => ({ chunkId: id })) },
      { name: 'summary', items: summaryHits.map((id: string) => ({ chunkId: id })) },
      { name: 'keyword', items: keywordHits.map((id: string) => ({ chunkId: id })) },
    ].filter((l) => l.items.length > 0);

    const fusedIds = lists.length > 0
      ? fusionRRF(lists, (item: any) => item.chunkId, (a: any) => a)
          .slice(0, topK)
          .map((r: any) => r.item.chunkId)
      : [];

    // 计算指标
    const computeMetrics = (hitIds: string[]): EvalMetrics => {
      const expected = new Set(q.expectedChunks);
      const hits = hitIds.filter((id) => expected.has(id));
      const precision = hitIds.length > 0 ? hits.length / hitIds.length : 0;
      const recall = expected.size > 0 ? hits.length / expected.size : 0;

      let mrr = 0;
      for (let i = 0; i < hitIds.length; i++) {
        if (expected.has(hitIds[i])) {
          mrr = 1 / (i + 1);
          break;
        }
      }

      return {
        queryId: q.id,
        precisionAtK: precision,
        recallAtK: recall,
        mrr,
        hitChunks: hits,
        missedChunks: q.expectedChunks.filter((id) => !hits.includes(id)),
      };
    };

    results.content_vector.push(computeMetrics(contentHits));
    results.summary_vector.push(computeMetrics(summaryHits));
    results.inverted_index.push(computeMetrics(keywordHits));
    results.rrf_fusion.push(computeMetrics(fusedIds));
  }

  // 输出报告
  console.log('\n=== Agent FS 召回准确率评测报告 ===\n');
  for (const [method, metrics] of Object.entries(results)) {
    const avgP = metrics.reduce((s, m) => s + m.precisionAtK, 0) / metrics.length;
    const avgR = metrics.reduce((s, m) => s + m.recallAtK, 0) / metrics.length;
    const avgMRR = metrics.reduce((s, m) => s + m.mrr, 0) / metrics.length;

    console.log(`[${method}]`);
    console.log(`  Avg Precision@${topK}: ${(avgP * 100).toFixed(1)}%`);
    console.log(`  Avg Recall@${topK}: ${(avgR * 100).toFixed(1)}%`);
    console.log(`  Avg MRR: ${avgMRR.toFixed(3)}`);
    console.log();
  }

  // 按 query 详情
  for (const q of dataset.queries) {
    console.log(`--- Query: ${q.id} "${q.query}" ---`);
    for (const [method, metrics] of Object.entries(results)) {
      const m = metrics.find((x) => x.queryId === q.id)!;
      console.log(`  [${method}] P=${(m.precisionAtK * 100).toFixed(0)}% R=${(m.recallAtK * 100).toFixed(0)}% MRR=${m.mrr.toFixed(2)} missed=${m.missedChunks.length}`);
    }
  }

  await invertedIndex.close();
  await vectorStore.close();
  await embeddingService.dispose();
}

// CLI entry
const datasetPath = process.argv[2];
if (!datasetPath) {
  console.error('Usage: npx tsx retrieval-eval.ts <dataset.json>');
  process.exit(1);
}
evaluate(datasetPath).catch(console.error);
```

**Step 3: Commit**

```bash
git add packages/e2e/src/retrieval-eval/
git commit -m "feat(eval): add retrieval accuracy evaluation script and dataset template"
```

> 注意：实际评测需要用户在已索引的项目上手动标注 `eval-dataset.json` 后运行。

---

## Summary

| Task | 说明 | 涉及包 |
|------|------|--------|
| 1 | txt 扩展名支持 | plugin-markdown |
| 2 | ~~Scanner 排除 memory~~ (无需改动) | — |
| 3 | MCP get_project_memory 工具 | mcp-server |
| 4 | Indexer 自动生成 project.md | indexer |
| 5 | Electron Memory IPC handlers | electron-app |
| 6 | Electron Memory 编辑 UI | electron-app |
| 7 | 文档更新 + .user.idea 清理 | docs |
| 8 | 召回评测脚本 | e2e |

---

*Plan Version: 1.0*
*Created: 2026-02-09*

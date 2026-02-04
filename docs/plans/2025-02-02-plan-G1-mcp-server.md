# [G1] MCP Server - MCP 服务实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 MCP Server，为 AI Agent 提供文档搜索能力

**Architecture:** stdio 模式 MCP Server，实现 4 个 tools

**Tech Stack:** @modelcontextprotocol/sdk

**依赖:** [F] indexer

**被依赖:** 无（终端应用）

**更新日期:** 2026-02-04（根据实际实现调整）

---

## 成功标准

- [ ] MCP Server 可启动
- [ ] list_indexes 返回所有索引目录
- [ ] dir_tree 返回目录结构
- [ ] search 返回搜索结果
- [ ] get_chunk 返回 chunk 详情
- [ ] 集成测试通过

---

## Task 1: 创建 mcp-server 包

**Files:**
- Create: `packages/mcp-server/package.json`
- Create: `packages/mcp-server/tsconfig.json`
- Create: `packages/mcp-server/src/index.ts`

**Step 1: 创建目录**

Run: `mkdir -p packages/mcp-server/src/tools`

**Step 2: 创建 package.json**

```json
{
  "name": "@agent-fs/mcp-server",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "agent-fs-mcp": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc -w"
  },
  "dependencies": {
    "@agent-fs/core": "workspace:*",
    "@agent-fs/search": "workspace:*",
    "@agent-fs/llm": "workspace:*",
    "@agent-fs/indexer": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

**Step 3: 创建 tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

---

## Task 2: 实现 MCP Server 主体

**Files:**
- Create: `packages/mcp-server/src/server.ts`

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { listIndexes } from './tools/list-indexes.js';
import { dirTree } from './tools/dir-tree.js';
import { search, initSearchService, disposeSearchService } from './tools/search.js';
import { getChunk } from './tools/get-chunk.js';

export async function createServer() {
  const server = new Server(
    {
      name: 'agent-fs',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // 列出可用工具
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_indexes',
        description: '列出所有已索引的目录及其摘要',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'dir_tree',
        description: '展示指定目录的文件结构和摘要',
        inputSchema: {
          type: 'object',
          properties: {
            scope: { type: 'string', description: '目录路径' },
            depth: { type: 'number', description: '展示深度，默认 2' },
          },
          required: ['scope'],
        },
      },
      {
        name: 'search',
        description: '在索引中搜索相关内容',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '语义查询' },
            keyword: { type: 'string', description: '精准关键词（可选）' },
            scope: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } },
              ],
              description: '搜索范围，目录路径',
            },
            top_k: { type: 'number', description: '返回数量，默认 10' },
          },
          required: ['query', 'scope'],
        },
      },
      {
        name: 'get_chunk',
        description: '获取指定 chunk 的详细内容',
        inputSchema: {
          type: 'object',
          properties: {
            chunk_id: { type: 'string', description: 'Chunk ID' },
            include_neighbors: { type: 'boolean', description: '是否包含相邻 chunk' },
            neighbor_count: { type: 'number', description: '相邻 chunk 数量' },
          },
          required: ['chunk_id'],
        },
      },
    ],
  }));

  // 处理工具调用
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'list_indexes':
          return { content: [{ type: 'text', text: JSON.stringify(await listIndexes()) }] };

        case 'dir_tree':
          return { content: [{ type: 'text', text: JSON.stringify(await dirTree(args as any)) }] };

        case 'search':
          return { content: [{ type: 'text', text: JSON.stringify(await search(args as any)) }] };

        case 'get_chunk':
          return { content: [{ type: 'text', text: JSON.stringify(await getChunk(args as any)) }] };

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function runServer() {
  // 初始化搜索服务（预加载，避免首次查询延迟）
  await initSearchService();

  const server = await createServer();
  const transport = new StdioServerTransport();

  // 优雅退出
  process.on('SIGINT', async () => {
    await disposeSearchService();
    process.exit(0);
  });

  await server.connect(transport);
  console.error('Agent FS MCP Server running on stdio');
}
```

---

## Task 3: 实现 list_indexes 工具

**Files:**
- Create: `packages/mcp-server/src/tools/list-indexes.ts`

```typescript
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Registry } from '@agent-fs/core';

export async function listIndexes() {
  const registryPath = join(homedir(), '.agent_fs', 'registry.json');

  if (!existsSync(registryPath)) {
    return { indexes: [] };
  }

  const registry: Registry = JSON.parse(readFileSync(registryPath, 'utf-8'));

  return {
    indexes: registry.indexedDirectories
      .filter((d) => d.valid)
      .map((d) => ({
        path: d.path,
        alias: d.alias,
        summary: d.summary,
        last_updated: d.lastUpdated,
        stats: {
          file_count: d.fileCount,
          chunk_count: d.chunkCount,
        },
      })),
  };
}
```

---

## Task 4: 实现 dir_tree 工具

**Files:**
- Create: `packages/mcp-server/src/tools/dir-tree.ts`

```typescript
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IndexMetadata } from '@agent-fs/core';

interface DirTreeInput {
  scope: string;
  depth?: number;
}

export async function dirTree(input: DirTreeInput) {
  const { scope, depth = 2 } = input;

  const indexPath = join(scope, '.fs_index', 'index.json');
  if (!existsSync(indexPath)) {
    throw new Error(`No index found at: ${scope}`);
  }

  const metadata: IndexMetadata = JSON.parse(readFileSync(indexPath, 'utf-8'));

  return buildTree(metadata, depth);
}

function buildTree(metadata: IndexMetadata, depth: number) {
  return {
    path: metadata.directoryPath,
    summary: metadata.directorySummary,
    files: metadata.files.map((f) => ({
      path: f.name,
      summary: f.summary,
      chunk_count: f.chunkCount,
    })),
    subdirectories: depth > 0
      ? metadata.subdirectories.map((s) => ({
          path: s.name,
          has_index: s.hasIndex,
          summary: s.summary,
        }))
      : [],
    unsupported_files: metadata.unsupportedFiles,
  };
}
```

---

## Task 5: 实现 search 工具（服务单例模式）

**Files:**
- Create: `packages/mcp-server/src/tools/search.ts`

**说明：** 使用服务单例模式，避免每次请求重复初始化 embedding 服务和向量存储。

```typescript
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { loadConfig } from '@agent-fs/core';
import type { EmbeddingService } from '@agent-fs/llm';
import { createEmbeddingService } from '@agent-fs/llm';
import type { VectorStore, BM25Index, SearchFusion } from '@agent-fs/search';
import { createVectorStore, loadIndex, indexExists, createSearchFusion } from '@agent-fs/search';

interface SearchInput {
  query: string;
  keyword?: string;
  scope: string | string[];
  top_k?: number;
}

// 服务单例
let embeddingService: EmbeddingService | null = null;
let vectorStore: VectorStore | null = null;
let bm25Index: BM25Index | null = null;
let searchFusion: SearchFusion | null = null;

/**
 * 初始化搜索服务（启动时调用）
 */
export async function initSearchService(): Promise<void> {
  if (searchFusion) return; // 已初始化

  const config = loadConfig();
  const storagePath = join(homedir(), '.agent_fs', 'storage');

  // 检查存储目录是否存在
  if (!existsSync(join(storagePath, 'vectors'))) {
    console.error('Warning: Vector storage not found. Search will not work until indexing is done.');
    return;
  }

  // 初始化 Embedding 服务
  embeddingService = createEmbeddingService(config.embedding);
  await embeddingService.init();

  // 初始化 VectorStore
  vectorStore = createVectorStore({
    storagePath: join(storagePath, 'vectors'),
    dimension: embeddingService.getDimension(),
  });
  await vectorStore.init();

  // 加载 BM25 索引
  const bm25Path = join(storagePath, 'bm25', 'index.json');
  if (indexExists(bm25Path)) {
    bm25Index = loadIndex(bm25Path);
  } else {
    // 创建空索引
    const { BM25Index: BM25IndexClass } = await import('@agent-fs/search');
    bm25Index = new BM25IndexClass();
  }

  // 创建搜索融合服务
  searchFusion = createSearchFusion(vectorStore, bm25Index, embeddingService);
}

/**
 * 释放搜索服务资源（退出时调用）
 */
export async function disposeSearchService(): Promise<void> {
  if (vectorStore) {
    await vectorStore.close();
    vectorStore = null;
  }
  if (embeddingService) {
    await embeddingService.dispose();
    embeddingService = null;
  }
  bm25Index = null;
  searchFusion = null;
}

/**
 * 获取 VectorStore 实例（供 get_chunk 使用）
 */
export function getVectorStore(): VectorStore {
  if (!vectorStore) {
    throw new Error('Search service not initialized. No indexes available.');
  }
  return vectorStore;
}

/**
 * 搜索工具实现
 */
export async function search(input: SearchInput) {
  if (!searchFusion) {
    throw new Error('Search service not initialized. Please index some directories first.');
  }

  // 调用 SearchFusion.search
  // 接口: search(options: SearchOptions, fusionOptions?: FusionOptions)
  const response = await searchFusion.search({
    query: input.query,
    keyword: input.keyword,
    scope: input.scope,
    topK: input.top_k ?? 10,
  });

  // 转换返回格式（camelCase → snake_case for MCP）
  return {
    results: response.results.map((r) => ({
      chunk_id: r.chunkId,
      score: r.score,
      content: r.content,
      summary: r.summary,
      source: {
        file_path: r.source.filePath,
        locator: r.source.locator,
      },
    })),
    meta: {
      total_searched: response.meta.totalSearched,
      fusion_method: response.meta.fusionMethod,
      elapsed_ms: response.meta.elapsedMs,
    },
  };
}
```

---

## Task 6: 实现 get_chunk 工具

**Files:**
- Create: `packages/mcp-server/src/tools/get-chunk.ts`

**说明：** 完整实现 chunk 详情获取，包括邻居 chunk 功能。

```typescript
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Registry, IndexMetadata } from '@agent-fs/core';
import { getVectorStore } from './search.js';

interface GetChunkInput {
  chunk_id: string;
  include_neighbors?: boolean;
  neighbor_count?: number;
}

interface ChunkInfo {
  id: string;
  content: string;
  summary: string;
  token_count: number;
  source: {
    file_path: string;
    locator: string;
  };
}

/**
 * 从 chunk_id 解析 file_id
 * chunk_id 格式: {file_id}:{chunk_index}
 */
function parseChunkId(chunkId: string): { fileId: string; chunkIndex: number } {
  const parts = chunkId.split(':');
  if (parts.length < 2) {
    throw new Error(`Invalid chunk_id format: ${chunkId}`);
  }
  const chunkIndex = parseInt(parts[parts.length - 1], 10);
  const fileId = parts.slice(0, -1).join(':');
  return { fileId, chunkIndex };
}

/**
 * 查找文件所在目录
 */
function findFileDirectory(fileId: string): { dirPath: string; fileName: string } | null {
  const registryPath = join(homedir(), '.agent_fs', 'registry.json');
  if (!existsSync(registryPath)) return null;

  const registry: Registry = JSON.parse(readFileSync(registryPath, 'utf-8'));

  for (const dir of registry.indexedDirectories) {
    if (!dir.valid) continue;

    const indexPath = join(dir.path, '.fs_index', 'index.json');
    if (!existsSync(indexPath)) continue;

    const metadata: IndexMetadata = JSON.parse(readFileSync(indexPath, 'utf-8'));
    const file = metadata.files.find((f) => f.fileId === fileId);
    if (file) {
      return { dirPath: dir.path, fileName: file.name };
    }
  }

  return null;
}

/**
 * 获取 chunk 详情
 */
export async function getChunk(input: GetChunkInput) {
  const { chunk_id, include_neighbors = false, neighbor_count = 2 } = input;

  // 方法1：从 VectorStore 获取（如果服务已初始化）
  try {
    const vectorStore = getVectorStore();
    const docs = await vectorStore.getByChunkIds([chunk_id]);

    if (docs.length > 0) {
      const doc = docs[0];
      const result: { chunk: ChunkInfo; neighbors?: { before: ChunkInfo[]; after: ChunkInfo[] } } = {
        chunk: {
          id: doc.chunk_id,
          content: doc.content,
          summary: doc.summary,
          token_count: Math.ceil(doc.content.length / 4), // 粗略估算
          source: {
            file_path: doc.file_path,
            locator: doc.locator,
          },
        },
      };

      // 获取邻居 chunks
      if (include_neighbors) {
        const { fileId, chunkIndex } = parseChunkId(chunk_id);
        const neighborIds: string[] = [];

        // 前面的 chunks
        for (let i = Math.max(0, chunkIndex - neighbor_count); i < chunkIndex; i++) {
          neighborIds.push(`${fileId}:${String(i).padStart(4, '0')}`);
        }

        // 后面的 chunks（尝试获取，可能不存在）
        for (let i = chunkIndex + 1; i <= chunkIndex + neighbor_count; i++) {
          neighborIds.push(`${fileId}:${String(i).padStart(4, '0')}`);
        }

        const neighborDocs = await vectorStore.getByChunkIds(neighborIds);
        const neighborMap = new Map(neighborDocs.map((d) => [d.chunk_id, d]));

        const before: ChunkInfo[] = [];
        const after: ChunkInfo[] = [];

        for (let i = Math.max(0, chunkIndex - neighbor_count); i < chunkIndex; i++) {
          const id = `${fileId}:${String(i).padStart(4, '0')}`;
          const neighbor = neighborMap.get(id);
          if (neighbor) {
            before.push({
              id: neighbor.chunk_id,
              content: neighbor.content,
              summary: neighbor.summary,
              token_count: Math.ceil(neighbor.content.length / 4),
              source: {
                file_path: neighbor.file_path,
                locator: neighbor.locator,
              },
            });
          }
        }

        for (let i = chunkIndex + 1; i <= chunkIndex + neighbor_count; i++) {
          const id = `${fileId}:${String(i).padStart(4, '0')}`;
          const neighbor = neighborMap.get(id);
          if (neighbor) {
            after.push({
              id: neighbor.chunk_id,
              content: neighbor.content,
              summary: neighbor.summary,
              token_count: Math.ceil(neighbor.content.length / 4),
              source: {
                file_path: neighbor.file_path,
                locator: neighbor.locator,
              },
            });
          }
        }

        result.neighbors = { before, after };
      }

      return result;
    }
  } catch {
    // VectorStore 未初始化，尝试从文件系统读取
  }

  // 方法2：从 .fs_index/documents 读取
  const { fileId, chunkIndex } = parseChunkId(chunk_id);
  const fileInfo = findFileDirectory(fileId);

  if (!fileInfo) {
    throw new Error(`Chunk not found: ${chunk_id}`);
  }

  const chunksPath = join(fileInfo.dirPath, '.fs_index', 'documents', fileInfo.fileName, 'chunks.json');
  const summaryPath = join(fileInfo.dirPath, '.fs_index', 'documents', fileInfo.fileName, 'summary.json');

  if (!existsSync(chunksPath)) {
    throw new Error(`Chunks file not found for: ${fileInfo.fileName}`);
  }

  const chunksData = JSON.parse(readFileSync(chunksPath, 'utf-8'));
  const summaryData = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf-8')) : null;

  const chunk = chunksData.chunks[chunkIndex];
  if (!chunk) {
    throw new Error(`Chunk index out of range: ${chunkIndex}`);
  }

  const result: { chunk: ChunkInfo; neighbors?: { before: ChunkInfo[]; after: ChunkInfo[] } } = {
    chunk: {
      id: chunk_id,
      content: chunk.content,
      summary: summaryData?.chunks?.[chunkIndex] || '',
      token_count: chunk.tokenCount || Math.ceil(chunk.content.length / 4),
      source: {
        file_path: join(fileInfo.dirPath, fileInfo.fileName),
        locator: chunk.locator,
      },
    },
  };

  if (include_neighbors) {
    const before: ChunkInfo[] = [];
    const after: ChunkInfo[] = [];

    for (let i = Math.max(0, chunkIndex - neighbor_count); i < chunkIndex; i++) {
      const c = chunksData.chunks[i];
      if (c) {
        before.push({
          id: `${fileId}:${String(i).padStart(4, '0')}`,
          content: c.content,
          summary: summaryData?.chunks?.[i] || '',
          token_count: c.tokenCount || Math.ceil(c.content.length / 4),
          source: {
            file_path: join(fileInfo.dirPath, fileInfo.fileName),
            locator: c.locator,
          },
        });
      }
    }

    for (let i = chunkIndex + 1; i <= chunkIndex + neighbor_count && i < chunksData.chunks.length; i++) {
      const c = chunksData.chunks[i];
      if (c) {
        after.push({
          id: `${fileId}:${String(i).padStart(4, '0')}`,
          content: c.content,
          summary: summaryData?.chunks?.[i] || '',
          token_count: c.tokenCount || Math.ceil(c.content.length / 4),
          source: {
            file_path: join(fileInfo.dirPath, fileInfo.fileName),
            locator: c.locator,
          },
        });
      }
    }

    result.neighbors = { before, after };
  }

  return result;
}
```

---

## Task 7: 更新入口文件

**Files:**
- Modify: `packages/mcp-server/src/index.ts`

```typescript
#!/usr/bin/env node
import { runServer } from './server.js';

runServer().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
```

---

## 完成检查清单

- [ ] MCP Server 框架搭建
- [ ] list_indexes 实现
- [ ] dir_tree 实现
- [ ] search 实现（含服务单例管理）
- [ ] get_chunk 实现（含邻居 chunk）
- [ ] stdio 通信正常
- [ ] 优雅退出（资源清理）

---

## 输出接口

```bash
# 启动 MCP Server
npx @agent-fs/mcp-server

# 或添加到 Claude Desktop 配置
{
  "mcpServers": {
    "agent-fs": {
      "command": "npx",
      "args": ["@agent-fs/mcp-server"]
    }
  }
}
```

---

## 注意事项

1. **服务单例模式**：MCP Server 是长运行进程，EmbeddingService 和 VectorStore 需要初始化后复用，避免每次请求重复加载模型。

2. **字段命名约定**：
   - 内部代码使用 camelCase（TypeScript 惯例）
   - MCP 工具输出使用 snake_case（便于 AI Agent 解析）

3. **错误处理**：搜索服务未初始化时（无索引），应返回友好错误信息而非崩溃。

4. **依赖的实际接口**：
   - `SearchFusion.search(options: SearchOptions, fusionOptions?: FusionOptions)`
   - `VectorStore.getByChunkIds(chunkIds: string[]): Promise<VectorDocument[]>`
   - `EmbeddingService.init()` / `dispose()`

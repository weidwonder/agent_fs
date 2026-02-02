# [G1] MCP Server - MCP 服务实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 MCP Server，为 AI Agent 提供文档搜索能力

**Architecture:** stdio 模式 MCP Server，实现 4 个 tools

**Tech Stack:** @modelcontextprotocol/sdk

**依赖:** [F] indexer

**被依赖:** 无（终端应用）

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
import { listIndexes } from './tools/list-indexes';
import { dirTree } from './tools/dir-tree';
import { search } from './tools/search';
import { getChunk } from './tools/get-chunk';

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
  const server = await createServer();
  const transport = new StdioServerTransport();
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

## Task 5: 实现 search 工具

**Files:**
- Create: `packages/mcp-server/src/tools/search.ts`

```typescript
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig } from '@agent-fs/core';
import { createEmbeddingService } from '@agent-fs/llm';
import { createVectorStore, BM25Index, loadIndex, createSearchFusion } from '@agent-fs/search';

interface SearchInput {
  query: string;
  keyword?: string;
  scope: string | string[];
  top_k?: number;
}

let searchService: any = null;

async function getSearchService() {
  if (searchService) return searchService;

  const config = loadConfig();
  const storagePath = join(homedir(), '.agent_fs', 'storage');

  const embeddingService = createEmbeddingService(config.embedding);
  await embeddingService.init();

  const vectorStore = createVectorStore({
    storagePath: join(storagePath, 'vectors'),
    dimension: embeddingService.getDimension(),
  });
  await vectorStore.init();

  const bm25Index = loadIndex(join(storagePath, 'bm25', 'index.json'));

  searchService = createSearchFusion(vectorStore, bm25Index, embeddingService);
  return searchService;
}

export async function search(input: SearchInput) {
  const fusion = await getSearchService();

  const response = await fusion.search({
    query: input.query,
    keyword: input.keyword,
    scope: input.scope,
    topK: input.top_k,
  });

  return {
    results: response.results.map((r: any) => ({
      chunk_id: r.chunkId,
      score: r.score,
      content: r.content,
      summary: r.summary,
      source: r.source,
    })),
    meta: response.meta,
  };
}
```

---

## Task 6: 实现 get_chunk 工具

**Files:**
- Create: `packages/mcp-server/src/tools/get-chunk.ts`

```typescript
interface GetChunkInput {
  chunk_id: string;
  include_neighbors?: boolean;
  neighbor_count?: number;
}

export async function getChunk(input: GetChunkInput) {
  // TODO: 实现从存储中获取 chunk 详情
  // 需要解析 chunk_id 获取 file_id，然后读取对应的 chunks.json

  return {
    chunk: {
      id: input.chunk_id,
      content: 'TODO: 从存储获取',
      summary: 'TODO',
      token_count: 0,
      source: {
        file_path: '',
        locator: '',
      },
    },
    neighbors: input.include_neighbors
      ? {
          before: [],
          after: [],
        }
      : undefined,
  };
}
```

---

## Task 7: 更新入口文件

**Files:**
- Modify: `packages/mcp-server/src/index.ts`

```typescript
#!/usr/bin/env node
import { runServer } from './server';

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
- [ ] search 实现
- [ ] get_chunk 实现
- [ ] stdio 通信正常

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

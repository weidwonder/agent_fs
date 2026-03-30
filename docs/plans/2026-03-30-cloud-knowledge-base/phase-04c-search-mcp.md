# Phase 4C: Search + MCP 完整工具 Parity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现云端搜索（HTTP + MCP）并确保 MCP 工具与本地版完全对等（6 个工具）。HTTP 路由和 MCP 工具复用同一 Service 层。

**Prerequisite:** Phase 4B complete.

---

## 关键设计约束

1. **MCP 和 HTTP 复用同一 Service 层**：`SearchService` / `McpToolService` 被 route 和 MCP handler 共同调用
2. **MCP 工具完整覆盖**：`list_indexes` + `dir_tree` + `search` + `get_chunk` + `get_project_memory` + `index_documents`
3. **EmbeddingService 全局单例**：不在每个请求中重新初始化

---

## File Map (新增)

```
packages/server/src/
├��─ services/
│   ├── search-service.ts           # 向量+倒排融合搜索
│   └── mcp-tool-service.ts         # 所有 MCP 工具的业务逻辑
├── routes/
│   └─��� search-routes.ts            # POST /search
├── mcp/
│   └── streamable.ts               # POST /mcp Streamable HTTP
```

---

### Task 1: SearchService

**Files:**
- Create: `packages/server/src/services/search-service.ts`

- [ ] **Step 1: Write SearchService**

```typescript
// packages/server/src/services/search-service.ts

import type { StorageAdapter } from '@agent-fs/storage-adapter';
import type { EmbeddingService } from '@agent-fs/llm';
import { getPool } from '@agent-fs/storage-cloud';

export interface SearchParams {
  tenantId: string;
  query: string;
  keyword?: string;
  scope?: string | string[];  // project IDs or directory IDs
  topK?: number;
}

export class SearchService {
  constructor(
    private readonly embeddingService: EmbeddingService,
  ) {}

  async search(params: SearchParams, adapter: StorageAdapter) {
    const { tenantId, query, keyword, scope, topK = 10 } = params;

    // Resolve scope to dirIds
    const dirIds = await this.resolveDirIds(tenantId, scope);

    // Vector search
    const queryVector = await this.embeddingService.embed(query);
    const vectorResults = await adapter.vector.searchByVector({
      vector: queryVector,
      dirIds,
      topK: topK * 2,
      mode: 'postfilter',
    });

    // Inverted index search
    const searchText = keyword || query;
    const invertedResults = await adapter.invertedIndex.search({
      query: searchText,
      dirIds,
      topK: topK * 2,
    });

    // RRF fusion (inline, same logic as local)
    const scoreMap = new Map<string, { chunkId: string; score: number; vectorDoc?: any; invertedResult?: any }>();
    const k = 60; // RRF constant

    vectorResults.forEach((r, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      scoreMap.set(r.chunk_id, {
        chunkId: r.chunk_id,
        score: rrfScore,
        vectorDoc: r.document,
      });
    });

    invertedResults.forEach((r, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      const existing = scoreMap.get(r.chunkId);
      if (existing) {
        existing.score += rrfScore;
        existing.invertedResult = r;
      } else {
        scoreMap.set(r.chunkId, { chunkId: r.chunkId, score: rrfScore, invertedResult: r });
      }
    });

    const fused = [...scoreMap.values()].sort((a, b) => b.score - a.score).slice(0, topK);

    // Enrich with content from archive
    const chunkIds = fused.map(f => f.chunkId);
    const docs = fused.filter(f => f.vectorDoc).length < fused.length
      ? await adapter.vector.getByChunkIds(chunkIds)
      : [];
    const docMap = new Map(docs.map(d => [d.chunk_id, d]));

    const results = fused.map(f => {
      const doc = f.vectorDoc || docMap.get(f.chunkId);
      return {
        chunkId: f.chunkId,
        score: f.score,
        fileId: doc?.file_id || f.invertedResult?.fileId,
        dirId: doc?.dir_id || f.invertedResult?.dirId,
        filePath: doc?.file_path || '',
        locator: doc?.locator || f.invertedResult?.locator || '',
        lineStart: doc?.chunk_line_start,
        lineEnd: doc?.chunk_line_end,
      };
    });

    return { results };
  }

  private async resolveDirIds(tenantId: string, scope?: string | string[]): Promise<string[]> {
    const pool = getPool();
    const scopes = !scope ? [] : Array.isArray(scope) ? scope : [scope];

    if (scopes.length === 0) {
      // All dirs for tenant
      const result = await pool.query(
        'SELECT d.id FROM directories d JOIN projects p ON d.project_id = p.id WHERE p.tenant_id = $1',
        [tenantId]
      );
      return result.rows.map((r: any) => r.id);
    }

    // Scopes may be project IDs or directory IDs
    const result = await pool.query(
      `SELECT d.id FROM directories d
       WHERE (d.project_id = ANY($1) OR d.id = ANY($1))
         AND d.project_id IN (SELECT id FROM projects WHERE tenant_id = $2)`,
      [scopes, tenantId]
    );
    return result.rows.map((r: any) => r.id);
  }
}
```

- [ ] **Step 2: Commit**

---

### Task 2: McpToolService

**Files:**
- Create: `packages/server/src/services/mcp-tool-service.ts`

- [ ] **Step 1: Write McpToolService — 集中所有 MCP 工具业务逻辑**

```typescript
// packages/server/src/services/mcp-tool-service.ts

import type { StorageAdapter } from '@agent-fs/storage-adapter';
import { getPool } from '@agent-fs/storage-cloud';
import type { SearchService } from './search-service.js';
import type { IndexingService } from './indexing-service.js';

export class McpToolService {
  constructor(
    private readonly searchService: SearchService,
    private readonly indexingService: IndexingService,
  ) {}

  async listIndexes(tenantId: string) {
    const pool = getPool();
    const result = await pool.query(
      `SELECT p.id, p.name, p.created_at,
              COUNT(f.id) AS file_count,
              COALESCE(SUM(f.chunk_count), 0) AS total_chunks
       FROM projects p
       LEFT JOIN directories d ON d.project_id = p.id
       LEFT JOIN files f ON f.directory_id = d.id AND f.status = 'indexed'
       WHERE p.tenant_id = $1
       GROUP BY p.id ORDER BY p.created_at DESC`,
      [tenantId]
    );
    return result.rows;
  }

  async dirTree(tenantId: string, scope: string, depth: number = 2) {
    const pool = getPool();
    // Recursive CTE to build directory tree
    const result = await pool.query(
      `WITH RECURSIVE tree AS (
         SELECT id, relative_path, summary, parent_dir_id, 0 AS level
         FROM directories
         WHERE (id = $1 OR project_id = $1)
           AND project_id IN (SELECT id FROM projects WHERE tenant_id = $2)
           AND parent_dir_id IS NULL
         UNION ALL
         SELECT d.id, d.relative_path, d.summary, d.parent_dir_id, t.level + 1
         FROM directories d
         JOIN tree t ON d.parent_dir_id = t.id
         WHERE t.level < $3
       )
       SELECT t.*, COALESCE(json_agg(json_build_object('name', f.name, 'summary', f.summary))
              FILTER (WHERE f.id IS NOT NULL), '[]') AS files
       FROM tree t
       LEFT JOIN files f ON f.directory_id = t.id AND f.status = 'indexed'
       GROUP BY t.id, t.relative_path, t.summary, t.parent_dir_id, t.level
       ORDER BY t.level, t.relative_path`,
      [scope, tenantId, depth]
    );
    return result.rows;
  }

  async search(tenantId: string, args: any, adapter: StorageAdapter) {
    return this.searchService.search({
      tenantId,
      query: args.query,
      keyword: args.keyword,
      scope: args.scope,
      topK: args.top_k,
    }, adapter);
  }

  async getChunk(tenantId: string, chunkId: string, adapter: StorageAdapter) {
    const docs = await adapter.vector.getByChunkIds([chunkId]);
    if (docs.length === 0) return { error: 'Chunk not found' };

    const doc = docs[0];
    let content = '';
    try {
      content = await adapter.archive.readText(doc.file_id, 'content.md');
      // Extract lines for this chunk
      if (doc.chunk_line_start && doc.chunk_line_end) {
        const lines = content.split('\n');
        content = lines.slice(doc.chunk_line_start - 1, doc.chunk_line_end).join('\n');
      }
    } catch {
      content = '(archive not available)';
    }

    return { chunkId, fileId: doc.file_id, content, locator: doc.locator, lineStart: doc.chunk_line_start, lineEnd: doc.chunk_line_end };
  }

  async getProjectMemory(tenantId: string, projectId: string, adapter: StorageAdapter) {
    return adapter.metadata.readProjectMemory(projectId);
  }

  async indexDocuments(tenantId: string, projectId: string, urls: string[]) {
    // For MCP: accept URLs, download, then enqueue
    const results: { url: string; fileId?: string; error?: string }[] = [];
    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        const fileName = new URL(url).pathname.split('/').pop() || 'document';
        const { fileId } = await this.indexingService.uploadAndEnqueue(tenantId, projectId, fileName, buffer);
        results.push({ url, fileId });
      } catch (err: any) {
        results.push({ url, error: err.message });
      }
    }
    return results;
  }
}
```

- [ ] **Step 2: Commit**

---

### Task 3: Search Route (HTTP)

- [ ] **Step 1: Write search-routes.ts**

```typescript
// packages/server/src/routes/search-routes.ts

import type { FastifyInstance } from 'fastify';
import { createAuthMiddleware } from '../middleware/auth.js';
import type { SearchService } from '../services/search-service.js';
import { createTenantAdapter } from '../di.js';

export async function searchRoutes(app: FastifyInstance, searchService: SearchService, jwtSecret: string) {
  const auth = createAuthMiddleware(jwtSecret);

  app.post('/search', { preHandler: auth }, async (request) => {
    const { query, keyword, scope, topK } = request.body as any;
    const adapter = createTenantAdapter(request.user!.tenantId);
    await adapter.init();
    try {
      return await searchService.search({
        tenantId: request.user!.tenantId,
        query, keyword, scope, topK,
      }, adapter);
    } finally {
      await adapter.close();
    }
  });
}
```

- [ ] **Step 2: Commit**

---

### Task 4: MCP Streamable HTTP — 完整 6 工具

- [ ] **Step 1: Write streamable.ts with all 6 tools**

```typescript
// packages/server/src/mcp/streamable.ts

import type { FastifyInstance } from 'fastify';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import type { McpToolService } from '../services/mcp-tool-service.js';
import { createTenantAdapter } from '../di.js';
import type { ServerConfig } from '../config.js';

export async function mcpRoutes(app: FastifyInstance, config: ServerConfig, mcpToolService: McpToolService) {
  const auth = createAuthMiddleware(config.jwtSecret);

  app.all('/mcp', { preHandler: auth }, async (request, reply) => {
    const tenantId = request.user!.tenantId;

    const mcpServer = new Server(
      { name: 'agent-fs-cloud', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        { name: 'list_indexes', description: '列出所有已索引的项目及统计', inputSchema: { type: 'object', properties: {} } },
        { name: 'dir_tree', description: '展示目录文件结构和摘要', inputSchema: {
          type: 'object',
          properties: {
            scope: { type: 'string', description: '项目ID或目录ID' },
            depth: { type: 'number', description: '展示深度，默认 2' },
          },
          required: ['scope'],
        }},
        { name: 'search', description: '在知识库中搜索相关内容', inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '语义查询' },
            keyword: { type: 'string', description: '精准关键词（可选）' },
            scope: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: '搜索范围' },
            top_k: { type: 'number', description: '返回数量，默认 10' },
          },
          required: ['query'],
        }},
        { name: 'get_chunk', description: '获取指定 chunk 的详细内容', inputSchema: {
          type: 'object',
          properties: { chunk_id: { type: 'string' } },
          required: ['chunk_id'],
        }},
        { name: 'get_project_memory', description: '获取项目 memory 内容', inputSchema: {
          type: 'object',
          properties: { project: { type: 'string', description: '项目ID' } },
          required: ['project'],
        }},
        { name: 'index_documents', description: '从 URL 下载并索引文档', inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string' },
            urls: { type: 'array', items: { type: 'string' } },
          },
          required: ['project_id', 'urls'],
        }},
      ],
    }));

    mcpServer.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name, arguments: args } = req.params;
      const adapter = createTenantAdapter(tenantId);
      await adapter.init();

      try {
        let result: any;
        switch (name) {
          case 'list_indexes':
            result = await mcpToolService.listIndexes(tenantId);
            break;
          case 'dir_tree':
            result = await mcpToolService.dirTree(tenantId, (args as any).scope, (args as any).depth);
            break;
          case 'search':
            result = await mcpToolService.search(tenantId, args, adapter);
            break;
          case 'get_chunk':
            result = await mcpToolService.getChunk(tenantId, (args as any).chunk_id, adapter);
            break;
          case 'get_project_memory':
            result = await mcpToolService.getProjectMemory(tenantId, (args as any).project, adapter);
            break;
          case 'index_documents':
            result = await mcpToolService.indexDocuments(tenantId, (args as any).project_id, (args as any).urls);
            break;
          default:
            return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      } finally {
        await adapter.close();
      }
    });

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcpServer.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
    reply.hijack();
  });
}
```

- [ ] **Step 2: Update app.ts to register all Phase 4B/4C routes and services**

```typescript
// In createApp():
const embeddingService = new EmbeddingService();
await embeddingService.init();

const searchService = new SearchService(embeddingService);
const indexingService = new IndexingService();
const mcpToolService = new McpToolService(searchService, indexingService);

await searchRoutes(app, searchService, config.jwtSecret);
await mcpRoutes(app, config, mcpToolService);
await documentRoutes(app, indexingService, config.jwtSecret);
await indexingEventRoutes(app, config.jwtSecret);

app.addHook('onClose', async () => {
  await embeddingService.dispose();
  await disposeDependencies();
});
```

- [ ] **Step 3: Build + test + commit**

```bash
pnpm --filter @agent-fs/server build
pnpm --filter @agent-fs/server test
git add packages/server/
git commit -m "feat(server): add SearchService, McpToolService, MCP Streamable HTTP with all 6 tools"
```

---

## Phase 4C Success Criteria

- [ ] `POST /search` 返回 RRF 融合结果
- [ ] `POST /mcp` 支持全部 6 个 MCP 工具
- [ ] MCP 工具与本地版对等：`list_indexes` / `dir_tree` / `search` / `get_chunk` / `get_project_memory` / `index_documents`
- [ ] HTTP 搜索与 MCP 搜索复用同一 `SearchService`
- [ ] 上传与 MCP `index_documents` 复用同一 `IndexingService`
- [ ] EmbeddingService 全局单例，生命周期由 app 管理
- [ ] 租户隔离：所有查询带 tenant_id 过滤

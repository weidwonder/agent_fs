// packages/server/src/mcp/streamable.ts
//
// MCP server using the official @modelcontextprotocol/sdk with StreamableHTTP transport.
// One McpServer instance is shared; tenantId is bound per-request via a closure factory.

import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createAuthMiddleware } from '../middleware/auth.js';
import type { McpToolService } from '../services/mcp-tool-service.js';
import type { ServerConfig } from '../config.js';
import { createCloudAdapter } from '@agent-fs/storage-cloud';

// Build a fresh McpServer with tenantId bound in each tool handler.
// A new instance is created per request to avoid cross-tenant state leaks.
function buildMcpServer(tenantId: string, mcpToolService: McpToolService): McpServer {
  const server = new McpServer({ name: 'agent-fs', version: '0.1.0' });

  server.tool('list_indexes', '列出所有已索引的项目及统计', {}, async () => {
    const rows = await mcpToolService.listIndexes(tenantId);
    return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
  });

  server.tool(
    'dir_tree',
    '展示目录文件结构和摘要',
    {
      scope: z.string().describe('项目ID或目录ID'),
      depth: z.number().optional().describe('展示深度，默认 2'),
    },
    async ({ scope, depth }) => {
      const rows = await mcpToolService.dirTree(tenantId, scope, depth ?? 2);
      return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
    },
  );

  server.tool(
    'search',
    '在知识库中搜索相关内容',
    {
      query: z.string().describe('语义查询'),
      keyword: z.string().optional().describe('精准关键词（可选）'),
      scope: z.union([z.string(), z.array(z.string())]).optional().describe('搜索范围'),
      top_k: z.number().optional().describe('返回数量，默认 10'),
    },
    async ({ query, keyword, scope, top_k }) => {
      const adapter = createCloudAdapter({ tenantId });
      await adapter.init();
      try {
        const result = await mcpToolService.search(tenantId, { query, keyword, scope, top_k }, adapter);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } finally {
        await adapter.close();
      }
    },
  );

  server.tool(
    'get_chunk',
    '获取指定 chunk 的详细内容',
    { chunk_id: z.string() },
    async ({ chunk_id }) => {
      const adapter = createCloudAdapter({ tenantId });
      await adapter.init();
      try {
        const result = await mcpToolService.getChunk(tenantId, chunk_id, adapter);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } finally {
        await adapter.close();
      }
    },
  );

  server.tool(
    'get_project_memory',
    '获取项目 memory 内容',
    { project: z.string().describe('项目ID') },
    async ({ project }) => {
      const adapter = createCloudAdapter({ tenantId });
      await adapter.init();
      try {
        const result = await mcpToolService.getProjectMemory(tenantId, project, adapter);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } finally {
        await adapter.close();
      }
    },
  );

  server.tool(
    'index_documents',
    '从 URL 下载并索引文档',
    {
      project_id: z.string(),
      urls: z.array(z.string()),
    },
    async ({ project_id, urls }) => {
      const result = await mcpToolService.indexDocuments(tenantId, project_id, urls);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  return server;
}

export async function mcpRoutes(
  app: FastifyInstance,
  config: ServerConfig,
  mcpToolService: McpToolService,
): Promise<void> {
  const auth = createAuthMiddleware(config.jwtSecret);

  // Stateless: new McpServer + transport per request so tenantId is isolated
  app.all('/mcp', { preHandler: auth }, async (request, reply) => {
    const tenantId = request.user!.tenantId;

    const mcpServer = buildMcpServer(tenantId, mcpToolService);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    await mcpServer.connect(transport);

    try {
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } finally {
      await transport.close();
      await mcpServer.close();
    }

    // SDK writes directly to Node.js ServerResponse — prevent Fastify double-send
    await reply.hijack();
  });
}

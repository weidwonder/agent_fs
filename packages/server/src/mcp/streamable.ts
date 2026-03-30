// packages/server/src/mcp/streamable.ts
//
// Simple JSON-RPC 2.0 handler that exposes all 6 MCP tools.
// @modelcontextprotocol/sdk is not a dependency — uses plain HTTP instead.

import type { FastifyInstance } from 'fastify';
import { createAuthMiddleware } from '../middleware/auth.js';
import type { McpToolService } from '../services/mcp-tool-service.js';
import type { ServerConfig } from '../config.js';
import { createCloudAdapter } from '@agent-fs/storage-cloud';

const TOOL_LIST = [
  {
    name: 'list_indexes',
    description: '列出所有已索引的项目及统计',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'dir_tree',
    description: '展示目录文件结构和摘要',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: '项目ID或目录ID' },
        depth: { type: 'number', description: '展示深度，默认 2' },
      },
      required: ['scope'],
    },
  },
  {
    name: 'search',
    description: '在知识库中搜索相关内容',
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
          description: '搜索范围',
        },
        top_k: { type: 'number', description: '返回数量，默认 10' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_chunk',
    description: '获取指定 chunk 的详细内容',
    inputSchema: {
      type: 'object',
      properties: { chunk_id: { type: 'string' } },
      required: ['chunk_id'],
    },
  },
  {
    name: 'get_project_memory',
    description: '获取项目 memory 内容',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string', description: '项目ID' } },
      required: ['project'],
    },
  },
  {
    name: 'index_documents',
    description: '从 URL 下载并索引文档',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        urls: { type: 'array', items: { type: 'string' } },
      },
      required: ['project_id', 'urls'],
    },
  },
];

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export async function mcpRoutes(
  app: FastifyInstance,
  config: ServerConfig,
  mcpToolService: McpToolService,
): Promise<void> {
  const auth = createAuthMiddleware(config.jwtSecret);

  app.post('/mcp', { preHandler: auth }, async (request, reply) => {
    const tenantId = request.user!.tenantId;
    const body = request.body as JsonRpcRequest;

    if (!body || body.jsonrpc !== '2.0') {
      return reply.status(400).send({ error: 'Invalid JSON-RPC request' });
    }

    // Notifications have no id and expect no response (HTTP 202)
    if (body.id === undefined || body.id === null) {
      await handleRpcRequest(tenantId, body, mcpToolService);
      return reply.status(202).send();
    }

    const response = await handleRpcRequest(tenantId, body, mcpToolService);
    return reply.header('content-type', 'application/json').send(response);
  });

  // Also handle GET for tools/list (convenience endpoint)
  app.get('/mcp/tools', { preHandler: auth }, async (_request, reply) => {
    return reply.send({ tools: TOOL_LIST });
  });
}

async function handleRpcRequest(
  tenantId: string,
  req: JsonRpcRequest,
  svc: McpToolService,
): Promise<JsonRpcResponse> {
  const { id, method, params } = req;

  try {
    let result: unknown;

    if (method === 'initialize') {
      // MCP initialize handshake — respond with server capabilities
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'agent-fs', version: '0.1.0' },
      };
    } else if (method === 'notifications/initialized') {
      // Client ack — no response needed (return null result)
      result = null;
    } else if (method === 'tools/list') {
      result = { tools: TOOL_LIST };
    } else if (method === 'tools/call') {
      const { name, arguments: args } = params as {
        name: string;
        arguments: Record<string, unknown>;
      };
      result = await callTool(tenantId, name, args ?? {}, svc);
    } else {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
    }

    return { jsonrpc: '2.0', id, result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message },
    };
  }
}

async function callTool(
  tenantId: string,
  name: string,
  args: Record<string, unknown>,
  svc: McpToolService,
): Promise<unknown> {
  switch (name) {
    case 'list_indexes':
      return svc.listIndexes(tenantId);

    case 'dir_tree': {
      const scope = args['scope'] as string;
      const depth = typeof args['depth'] === 'number' ? args['depth'] : 2;
      return svc.dirTree(tenantId, scope, depth);
    }

    case 'search': {
      const adapter = createCloudAdapter({ tenantId });
      await adapter.init();
      try {
        return await svc.search(
          tenantId,
          {
            query: args['query'] as string,
            keyword: args['keyword'] as string | undefined,
            scope: args['scope'] as string | string[] | undefined,
            top_k: args['top_k'] as number | undefined,
          },
          adapter,
        );
      } finally {
        await adapter.close();
      }
    }

    case 'get_chunk': {
      const adapter = createCloudAdapter({ tenantId });
      await adapter.init();
      try {
        return await svc.getChunk(tenantId, args['chunk_id'] as string, adapter);
      } finally {
        await adapter.close();
      }
    }

    case 'get_project_memory': {
      const adapter = createCloudAdapter({ tenantId });
      await adapter.init();
      try {
        return await svc.getProjectMemory(
          tenantId,
          args['project'] as string,
          adapter,
        );
      } finally {
        await adapter.close();
      }
    }

    case 'index_documents':
      return svc.indexDocuments(
        tenantId,
        args['project_id'] as string,
        args['urls'] as string[],
      );

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

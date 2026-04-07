import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { listIndexes } from './tools/list-indexes.js';
import { dirTree } from './tools/dir-tree.js';
import { search } from './tools/search.js';
import { getChunk } from './tools/get-chunk.js';
import { getProjectMemory } from './tools/get-project-memory.js';

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
      {
        name: 'get_project_memory',
        description: '获取项目 memory 路径、project.md 内容和 memory 文件列表',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'projectId 或项目路径' },
          },
          required: ['project'],
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

        case 'get_project_memory':
          return {
            content: [{ type: 'text', text: JSON.stringify(await getProjectMemory(args as any)) }],
          };

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

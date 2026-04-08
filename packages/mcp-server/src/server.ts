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
import { globMd } from './tools/glob-md.js';
import { readMd } from './tools/read-md.js';
import { grepMd } from './tools/grep-md.js';

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
        name: 'glob_md',
        description: '列出指定范围内可读取的 Markdown 原文文件',
        inputSchema: {
          type: 'object',
          properties: {
            scope: { type: 'string', description: '目录路径' },
            pattern: { type: 'string', description: 'glob 模式，默认 **/*' },
            limit: { type: 'number', description: '返回数量上限，默认 100' },
          },
          required: ['scope'],
        },
      },
      {
        name: 'read_md',
        description: '读取指定文档的 Markdown 原文，可按行范围截取',
        inputSchema: {
          type: 'object',
          properties: {
            scope: { type: 'string', description: '目录路径' },
            path: { type: 'string', description: '相对于当前 scope 的文件路径' },
            file_id: { type: 'string', description: '文件 ID' },
            start_line: { type: 'number', description: '起始行，1-based' },
            end_line: { type: 'number', description: '结束行，1-based' },
          },
          required: ['scope'],
        },
      },
      {
        name: 'grep_md',
        description: '在 Markdown 原文中做精确文本搜索并返回上下文',
        inputSchema: {
          type: 'object',
          properties: {
            scope: { type: 'string', description: '目录路径' },
            query: { type: 'string', description: '待搜索的文本' },
            pattern: { type: 'string', description: '可选 glob 模式' },
            path: { type: 'string', description: '相对于当前 scope 的文件路径' },
            file_id: { type: 'string', description: '文件 ID' },
            context_lines: { type: 'number', description: '上下文行数，默认 2' },
            limit: { type: 'number', description: '返回命中数量上限，默认 20' },
            case_sensitive: { type: 'boolean', description: '是否区分大小写' },
          },
          required: ['scope', 'query'],
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

        case 'glob_md':
          return { content: [{ type: 'text', text: JSON.stringify(await globMd(args as any)) }] };

        case 'read_md':
          return { content: [{ type: 'text', text: JSON.stringify(await readMd(args as any)) }] };

        case 'grep_md':
          return { content: [{ type: 'text', text: JSON.stringify(await grepMd(args as any)) }] };

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

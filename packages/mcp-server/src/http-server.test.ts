import { afterEach, describe, expect, it, vi } from 'vitest';
import { startHttpServer } from './http-server.js';

const mocks = vi.hoisted(() => ({
  listIndexes: vi.fn(),
  dirTree: vi.fn(),
  search: vi.fn(),
  getChunk: vi.fn(),
  getProjectMemory: vi.fn(),
  initSearchService: vi.fn(),
  disposeSearchService: vi.fn(),
}));

vi.mock('./tools/list-indexes.js', () => ({
  listIndexes: mocks.listIndexes,
}));

vi.mock('./tools/dir-tree.js', () => ({
  dirTree: mocks.dirTree,
}));

vi.mock('./tools/search.js', () => ({
  search: mocks.search,
  initSearchService: mocks.initSearchService,
  disposeSearchService: mocks.disposeSearchService,
}));

vi.mock('./tools/get-chunk.js', () => ({
  getChunk: mocks.getChunk,
}));

vi.mock('./tools/get-project-memory.js', () => ({
  getProjectMemory: mocks.getProjectMemory,
}));

describe('startHttpServer', () => {
  let server: Awaited<ReturnType<typeof startHttpServer>> | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }

    vi.clearAllMocks();
  });

  it('通过 streamable HTTP 暴露 MCP initialize、tools/list 和 tools/call', async () => {
    mocks.listIndexes.mockResolvedValue({
      indexes: [{ path: '/tmp/project', alias: 'demo' }],
    });
    mocks.initSearchService.mockResolvedValue(undefined);
    mocks.disposeSearchService.mockResolvedValue(undefined);

    server = await startHttpServer({ host: '127.0.0.1', port: 0 });

    const initializeResponse = await fetch(`${server.url}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'vitest-client',
            version: '1.0.0',
          },
        },
      }),
    });

    expect(initializeResponse.status).toBe(200);
    expect(await readJsonRpcPayload(initializeResponse)).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        serverInfo: {
          name: 'agent-fs',
        },
      },
    });

    const toolsListResponse = await fetch(`${server.url}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      }),
    });

    expect(toolsListResponse.status).toBe(200);

    const toolsListPayload = (await readJsonRpcPayload(toolsListResponse)) as {
      result: { tools: Array<{ name: string }> };
    };

    expect(toolsListPayload.result.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['list_indexes', 'dir_tree', 'search', 'get_chunk', 'get_project_memory']),
    );

    const callResponse = await fetch(`${server.url}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'list_indexes',
          arguments: {},
        },
      }),
    });

    expect(callResponse.status).toBe(200);

    const callPayload = (await readJsonRpcPayload(callResponse)) as {
      result: { content: Array<{ text: string }> };
    };

    expect(JSON.parse(callPayload.result.content[0].text)).toEqual({
      indexes: [{ path: '/tmp/project', alias: 'demo' }],
    });
    expect(mocks.listIndexes).toHaveBeenCalledTimes(1);
  });

  it('暴露健康检查接口', async () => {
    mocks.initSearchService.mockResolvedValue(undefined);
    mocks.disposeSearchService.mockResolvedValue(undefined);

    server = await startHttpServer({ host: '127.0.0.1', port: 0 });

    const response = await fetch(`${server.url}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('在搜索服务初始化失败时记录错误但不阻塞启动和请求', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.initSearchService
        .mockRejectedValueOnce(new Error('startup failed'))
        .mockRejectedValueOnce(new Error('request failed'));
      mocks.disposeSearchService.mockResolvedValue(undefined);

      server = await startHttpServer({ host: '127.0.0.1', port: 0 });

      const response = await fetch(`${server.url}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'vitest-client',
              version: '1.0.0',
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(consoleError).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('启动阶段初始化搜索服务失败'),
        expect.any(Error),
      );
      expect(consoleError).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('请求阶段初始化搜索服务失败'),
        expect.any(Error),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('对不受支持的 MCP HTTP method 返回 405', async () => {
    mocks.initSearchService.mockResolvedValue(undefined);
    mocks.disposeSearchService.mockResolvedValue(undefined);

    server = await startHttpServer({ host: '127.0.0.1', port: 0 });

    const response = await fetch(`${server.url}/mcp`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
    });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, POST');
    expect(await response.json()).toEqual({ error: 'Method not allowed' });
  });

  it('绑定 0.0.0.0 时对外展示 127.0.0.1 地址', async () => {
    mocks.initSearchService.mockResolvedValue(undefined);
    mocks.disposeSearchService.mockResolvedValue(undefined);

    server = await startHttpServer({ host: '0.0.0.0', port: 0 });

    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const response = await fetch(`${server.url}/health`);

    expect(response.status).toBe(200);
  });
});

async function readJsonRpcPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  const dataLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('data:'));

  if (!dataLine) {
    throw new Error(`未找到 JSON-RPC 数据帧: ${text}`);
  }

  return JSON.parse(dataLine.slice('data:'.length).trim());
}

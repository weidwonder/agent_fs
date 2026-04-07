import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ListenOptions } from './listen-config.js';
import { createServer as createMcpServer } from './server.js';
import { disposeSearchService, initSearchService } from './tools/search.js';

/** Shutdown 超时（毫秒），超时后强制断开所有连接 */
const SHUTDOWN_TIMEOUT_MS = 5_000;

export interface RunningHttpServer {
  host: string;
  port: number;
  url: string;
  mcpUrl: string;
  healthUrl: string;
  close(): Promise<void>;
}

export async function startHttpServer(options: ListenOptions): Promise<RunningHttpServer> {
  // 尝试初始化搜索服务；失败不阻塞启动，后续请求会懒加载重试
  await tryInitSearchService('启动阶段');

  let closed = false;

  /** 跟踪活跃的 MCP transport + server，以便 shutdown 时主动关闭 */
  const activeConnections = new Set<{ transport: StreamableHTTPServerTransport; server: McpServer }>();

  const httpServer = createHttpServer((request, response) => {
    void handleRequest(request, response, activeConnections);
  });

  try {
    await listen(httpServer, options.port, options.host);
  } catch (error) {
    await disposeSearchService();
    throw error;
  }

  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    await closeServer(httpServer);
    await disposeSearchService();
    throw new Error('无法获取 MCP HTTP 服务监听地址');
  }

  const origin = createOrigin(options.host, address.port);

  return {
    host: options.host,
    port: address.port,
    url: origin,
    mcpUrl: `${origin}/mcp`,
    healthUrl: `${origin}/health`,
    close: async () => {
      if (closed) {
        return;
      }

      closed = true;

      // 主动关闭所有活跃的 SSE transport，使 server.close() 不会因长连接挂起
      const closePromises = [...activeConnections].map(async (conn) => {
        try {
          await conn.transport.close();
          await conn.server.close();
        } catch {
          // 忽略关闭时的错误
        }
      });
      await Promise.allSettled(closePromises);
      activeConnections.clear();

      // 带超时的 server.close()：超时后强制断开剩余连接
      await closeServerWithTimeout(httpServer, SHUTDOWN_TIMEOUT_MS);
      await disposeSearchService();
    },
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  activeConnections: Set<{ transport: StreamableHTTPServerTransport; server: McpServer }>,
): Promise<void> {
  const pathname = getPathname(request);

  if (pathname === '/health') {
    respondJson(response, 200, { status: 'ok' });
    return;
  }

  if (pathname !== '/mcp') {
    respondJson(response, 404, { error: 'Not found' });
    return;
  }

  if (!isSupportedMcpMethod(request.method)) {
    respondMethodNotAllowed(response);
    return;
  }

  // 懒加载：每次 search 请求时尝试初始化（如果尚未就绪）
  await tryInitSearchService('请求阶段');

  const server = await createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const conn = { transport, server };
  activeConnections.add(conn);

  try {
    await server.connect(transport);
    await transport.handleRequest(request, response);
  } catch (error) {
    if (!response.headersSent && !response.writableEnded) {
      respondJson(response, 500, {
        error: error instanceof Error ? error.message : '未知错误',
      });
    }
  } finally {
    activeConnections.delete(conn);
    await transport.close();
    await server.close();
  }
}

function getPathname(request: IncomingMessage): string {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
  return url.pathname;
}

function respondJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function respondMethodNotAllowed(response: ServerResponse): void {
  response.setHeader('allow', 'GET, POST');
  respondJson(response, 405, { error: 'Method not allowed' });
}

function isSupportedMcpMethod(method: string | undefined): boolean {
  return method === 'GET' || method === 'POST';
}

async function tryInitSearchService(stage: '启动阶段' | '请求阶段'): Promise<void> {
  try {
    await initSearchService();
  } catch (error) {
    console.error(`[mcp-server] ${stage}初始化搜索服务失败，服务会继续运行并在后续请求重试`, error);
  }
}

function listen(
  server: ReturnType<typeof createHttpServer>,
  port: number,
  host: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };

    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function closeServer(server: ReturnType<typeof createHttpServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function closeServerWithTimeout(
  server: ReturnType<typeof createHttpServer>,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      // 超时：强制断开所有剩余连接
      server.closeAllConnections();
      resolve();
    }, timeoutMs);

    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function createOrigin(host: string, port: number): string {
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  const normalizedHost =
    displayHost.includes(':') && !displayHost.startsWith('[') ? `[${displayHost}]` : displayHost;
  return `http://${normalizedHost}:${port}`;
}

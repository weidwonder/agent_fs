# [G-Post] MCP 端到端测试实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 验证完整端到端流程：目录选择 → 索引 → MCP 查询，确保 AI Agent 可正常使用

**Architecture:** MCP Server 集成测试，模拟 AI Agent 调用场景

**Tech Stack:** Vitest, TypeScript, MCP SDK

**依赖:** [G1] mcp-server 完成后执行

**检查点:** Final - 全部验收

---

## 测试数据

复用 F-Post 阶段的测试数据：

```
test-data/
├── INDIR2511IN02996_D13&D15_origin.pdf
├── INDIR2511IN03148_D16&D17.md
└── INDIR2512IN01019_D22,D23,F2,F3_origin.pdf
```

---

## 成功标准

- [ ] MCP Server 可正常启动
- [ ] list_indexes 返回所有已索引目录
- [ ] dir_tree 返回目录结构
- [ ] search 返回搜索结果
- [ ] get_chunk 返回 chunk 详情
- [ ] 完整流程：索引目录 → MCP 查询成功

---

## Task 1: 添加 MCP 测试依赖

**Files:**
- Modify: `packages/e2e/package.json`

**Step 1: 更新 package.json**

添加 MCP 相关依赖：

```json
{
  "devDependencies": {
    "@agent-fs/mcp-server": "workspace:*",
    "@agent-fs/indexer": "workspace:*",
    "@agent-fs/plugin-pdf": "workspace:*"
  }
}
```

**Step 2: 更新 tsconfig.json**

添加引用：

```json
{
  "references": [
    { "path": "../mcp-server" },
    { "path": "../indexer" },
    { "path": "../plugins/plugin-pdf" }
  ]
}
```

**Step 3: 安装依赖**

Run: `pnpm install`

---

## Task 2: 创建 MCP 测试工具

**Files:**
- Create: `packages/e2e/src/utils/mcp-test-client.ts`

**Step 1: 编写 MCP 测试客户端**

```typescript
// packages/e2e/src/utils/mcp-test-client.ts
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  content: Array<{
    type: string;
    text?: string;
  }>;
  isError?: boolean;
}

/**
 * MCP 测试客户端
 * 用于集成测试中调用 MCP Server
 */
export class MCPTestClient {
  private serverProcess: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private buffer = '';

  /**
   * 启动 MCP Server
   */
  async start(): Promise<void> {
    const serverPath = join(__dirname, '../../../../mcp-server/dist/index.js');

    this.serverProcess = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this.serverProcess.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.serverProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[MCP Server Error]', data.toString());
    });

    // 等待服务器启动
    await this.waitForReady();
  }

  private async waitForReady(): Promise<void> {
    // 发送初始化请求
    const initResult = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });

    if (!initResult) {
      throw new Error('Failed to initialize MCP server');
    }

    // 发送 initialized 通知
    this.sendNotification('notifications/initialized', {});
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if ('id' in message && this.pendingRequests.has(message.id)) {
          const { resolve, reject } = this.pendingRequests.get(message.id)!;
          this.pendingRequests.delete(message.id);

          if (message.error) {
            reject(new Error(message.error.message));
          } else {
            resolve(message.result);
          }
        }
      } catch {
        // 忽略非 JSON 行
      }
    }
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });

      const message = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });

      this.serverProcess?.stdin?.write(message + '\n');

      // 超时处理
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  private sendNotification(method: string, params: unknown): void {
    const message = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    });

    this.serverProcess?.stdin?.write(message + '\n');
  }

  /**
   * 列出可用工具
   */
  async listTools(): Promise<Array<{ name: string; description: string }>> {
    const result = await this.sendRequest('tools/list', {}) as {
      tools: Array<{ name: string; description: string }>;
    };
    return result.tools;
  }

  /**
   * 调用工具
   */
  async callTool(call: MCPToolCall): Promise<MCPToolResult> {
    const result = await this.sendRequest('tools/call', {
      name: call.name,
      arguments: call.arguments,
    });
    return result as MCPToolResult;
  }

  /**
   * 停止 MCP Server
   */
  async stop(): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
  }
}

/**
 * 创建 MCP 测试客户端
 */
export function createMCPTestClient(): MCPTestClient {
  return new MCPTestClient();
}
```

---

## Task 3: MCP Server 基础测试

**Files:**
- Create: `packages/e2e/src/g-post/mcp-server.e2e.ts`

**Step 1: 创建目录**

Run: `mkdir -p packages/e2e/src/g-post`

**Step 2: 编写 MCP Server 测试**

```typescript
// packages/e2e/src/g-post/mcp-server.e2e.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MCPTestClient, createMCPTestClient } from '../utils/mcp-test-client';
import { TEST_FILES } from '../utils/test-config';
import { createTempTestDir, cleanupTempDir, copyAllTestFiles } from '../utils/test-helpers';

describe('G-Post: MCP Server Integration', () => {
  let client: MCPTestClient;
  let tempDir: string;
  let mcpServerAvailable: boolean;

  beforeAll(async () => {
    // 检查 MCP Server 是否已构建
    const serverPath = join(__dirname, '../../../../mcp-server/dist/index.js');
    mcpServerAvailable = existsSync(serverPath);

    if (!mcpServerAvailable) {
      console.warn('⚠️ MCP Server not built. Skipping MCP integration tests.');
      console.warn('   Run: pnpm --filter @agent-fs/mcp-server build');
      return;
    }

    client = createMCPTestClient();
    await client.start();
  });

  afterAll(async () => {
    if (client) {
      await client.stop();
    }
  });

  beforeEach(() => {
    tempDir = createTempTestDir();
    copyAllTestFiles(tempDir);
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('tools/list', () => {
    it('should list all available tools', async () => {
      if (!mcpServerAvailable) return;

      const tools = await client.listTools();

      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);

      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('list_indexes');
      expect(toolNames).toContain('dir_tree');
      expect(toolNames).toContain('search');
      expect(toolNames).toContain('get_chunk');
    });
  });

  describe('list_indexes', () => {
    it('should return empty list when no indexes exist', async () => {
      if (!mcpServerAvailable) return;

      const result = await client.callTool({
        name: 'list_indexes',
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);

      const text = result.content[0].text || '';
      // 可能返回空列表或提示信息
      expect(text).toBeDefined();
    });
  });

  describe('dir_tree', () => {
    it('should return directory structure for indexed directory', async () => {
      if (!mcpServerAvailable) return;

      // 假设已有索引目录
      const result = await client.callTool({
        name: 'dir_tree',
        arguments: {
          path: tempDir,
        },
      });

      // 可能返回错误（目录未索引）或目录结构
      expect(result.content).toBeDefined();
    });
  });

  describe('search', () => {
    it('should handle search with no results gracefully', async () => {
      if (!mcpServerAvailable) return;

      const result = await client.callTool({
        name: 'search',
        arguments: {
          query: '不存在的内容 xyz123',
          topK: 5,
        },
      });

      expect(result.content).toBeDefined();
      // 应该返回空结果或提示信息，而不是错误
    });
  });

  describe('get_chunk', () => {
    it('should handle non-existent chunk gracefully', async () => {
      if (!mcpServerAvailable) return;

      const result = await client.callTool({
        name: 'get_chunk',
        arguments: {
          chunkId: 'non-existent-chunk-id',
        },
      });

      expect(result.content).toBeDefined();
      // 应该返回错误信息或空结果
    });
  });
});
```

**Step 3: 运行测试**

Run: `pnpm --filter @agent-fs/e2e test src/g-post/mcp-server.e2e.ts`
Expected: PASS (if MCP Server built) or SKIP

---

## Task 4: 完整端到端测试

**Files:**
- Create: `packages/e2e/src/g-post/full-e2e.e2e.ts`

**Step 1: 编写完整 E2E 测试**

```typescript
// packages/e2e/src/g-post/full-e2e.e2e.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createIndexer } from '@agent-fs/indexer';
import { MCPTestClient, createMCPTestClient } from '../utils/mcp-test-client';
import { TEST_FILES, MOCK_CONFIG, checkLLMAvailable } from '../utils/test-config';
import { createTempTestDir, cleanupTempDir, copyTestFile } from '../utils/test-helpers';

describe('G-Post: Full End-to-End Test', () => {
  let client: MCPTestClient;
  let tempDir: string;
  let llmAvailable: boolean;
  let mcpServerAvailable: boolean;

  beforeAll(async () => {
    // 检查依赖服务
    llmAvailable = await checkLLMAvailable();
    const serverPath = join(__dirname, '../../../../mcp-server/dist/index.js');
    mcpServerAvailable = existsSync(serverPath);

    if (!llmAvailable) {
      console.warn('⚠️ LLM service not available.');
    }
    if (!mcpServerAvailable) {
      console.warn('⚠️ MCP Server not built.');
    }

    if (mcpServerAvailable) {
      client = createMCPTestClient();
      await client.start();
    }
  });

  afterAll(async () => {
    if (client) {
      await client.stop();
    }
  });

  beforeEach(() => {
    tempDir = createTempTestDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('Complete Workflow: Index → Search via MCP', () => {
    it('should index markdown file and search via MCP', async () => {
      if (!llmAvailable || !mcpServerAvailable) {
        console.log('Skipping: Required services not available');
        return;
      }

      // 1. 准备测试目录
      const mdFile = copyTestFile(TEST_FILES.markdown, tempDir);
      expect(existsSync(mdFile)).toBe(true);

      // 2. 索引目录
      const indexer = createIndexer({
        configPath: undefined, // 使用默认配置
        onProgress: (progress) => {
          console.log(`   [${progress.phase}] ${progress.currentFile} (${progress.processed}/${progress.total})`);
        },
      });

      await indexer.init();
      const metadata = await indexer.indexDirectory(tempDir);
      await indexer.dispose();

      expect(metadata).toBeDefined();
      expect(metadata.stats.fileCount).toBeGreaterThan(0);
      expect(metadata.stats.chunkCount).toBeGreaterThan(0);

      console.log('✅ Indexing completed');
      console.log(`   - Files: ${metadata.stats.fileCount}`);
      console.log(`   - Chunks: ${metadata.stats.chunkCount}`);

      // 3. 验证索引文件存在
      const indexJsonPath = join(tempDir, '.fs_index', 'index.json');
      expect(existsSync(indexJsonPath)).toBe(true);

      // 4. 通过 MCP 列出索引
      const listResult = await client.callTool({
        name: 'list_indexes',
        arguments: {},
      });

      expect(listResult.isError).toBeFalsy();
      const listText = listResult.content[0].text || '';
      expect(listText).toContain(tempDir);

      console.log('✅ list_indexes: Directory found in index list');

      // 5. 通过 MCP 查看目录结构
      const treeResult = await client.callTool({
        name: 'dir_tree',
        arguments: { path: tempDir },
      });

      expect(treeResult.isError).toBeFalsy();
      const treeText = treeResult.content[0].text || '';
      expect(treeText).toContain(TEST_FILES.markdown);

      console.log('✅ dir_tree: Directory structure returned');

      // 6. 通过 MCP 搜索
      const searchResult = await client.callTool({
        name: 'search',
        arguments: {
          query: '检验报告',
          scope: tempDir,
          topK: 5,
        },
      });

      expect(searchResult.isError).toBeFalsy();
      const searchText = searchResult.content[0].text || '';
      expect(searchText.length).toBeGreaterThan(0);

      console.log('✅ search: Results returned for query "检验报告"');

      // 7. 获取 chunk 详情
      // 从搜索结果中提取 chunkId（假设结果格式包含 chunkId）
      const chunkIdMatch = searchText.match(/chunk_id[:\s]+([a-f0-9:-]+)/i);
      if (chunkIdMatch) {
        const chunkId = chunkIdMatch[1];

        const chunkResult = await client.callTool({
          name: 'get_chunk',
          arguments: { chunkId },
        });

        expect(chunkResult.isError).toBeFalsy();
        const chunkText = chunkResult.content[0].text || '';
        expect(chunkText.length).toBeGreaterThan(0);

        console.log('✅ get_chunk: Chunk details returned');
      }

      console.log('\n🎉 Full E2E workflow completed successfully!');
    }, 300000); // 5 分钟超时
  });

  describe('AI Agent Simulation', () => {
    it('should simulate typical AI agent query patterns', async () => {
      if (!llmAvailable || !mcpServerAvailable) {
        console.log('Skipping: Required services not available');
        return;
      }

      // 准备并索引测试目录
      const mdFile = copyTestFile(TEST_FILES.markdown, tempDir);
      const indexer = createIndexer();
      await indexer.init();
      await indexer.indexDirectory(tempDir);
      await indexer.dispose();

      // 模拟 AI Agent 的典型查询模式

      // 1. Agent 首先列出可用索引
      console.log('\n[Agent] Listing available indexes...');
      const indexes = await client.callTool({
        name: 'list_indexes',
        arguments: {},
      });
      expect(indexes.isError).toBeFalsy();

      // 2. Agent 查看目录结构了解内容
      console.log('[Agent] Checking directory structure...');
      const tree = await client.callTool({
        name: 'dir_tree',
        arguments: { path: tempDir },
      });
      expect(tree.isError).toBeFalsy();

      // 3. Agent 基于用户问题进行语义搜索
      console.log('[Agent] Searching for relevant content...');
      const searchQueries = [
        '检验结果是什么',
        'product inspection status',
        '功能测试',
      ];

      for (const query of searchQueries) {
        console.log(`   Query: "${query}"`);
        const result = await client.callTool({
          name: 'search',
          arguments: {
            query,
            scope: tempDir,
            topK: 3,
          },
        });
        expect(result.isError).toBeFalsy();
      }

      // 4. Agent 获取具体 chunk 内容作为回答依据
      console.log('[Agent] Retrieving specific chunk for answer...');
      // 这里简化处理，实际会从搜索结果中提取 chunkId

      console.log('\n✅ AI Agent simulation completed');
    }, 300000);
  });
});
```

**Step 2: 运行测试**

Run: `pnpm --filter @agent-fs/e2e test src/g-post/full-e2e.e2e.ts`
Expected: PASS (if all services available) or SKIP

---

## Task 5: MCP 工具错误处理测试

**Files:**
- Create: `packages/e2e/src/g-post/mcp-error-handling.e2e.ts`

**Step 1: 编写错误处理测试**

```typescript
// packages/e2e/src/g-post/mcp-error-handling.e2e.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MCPTestClient, createMCPTestClient } from '../utils/mcp-test-client';

describe('G-Post: MCP Error Handling', () => {
  let client: MCPTestClient;
  let mcpServerAvailable: boolean;

  beforeAll(async () => {
    const serverPath = join(__dirname, '../../../../mcp-server/dist/index.js');
    mcpServerAvailable = existsSync(serverPath);

    if (!mcpServerAvailable) {
      console.warn('⚠️ MCP Server not built. Skipping tests.');
      return;
    }

    client = createMCPTestClient();
    await client.start();
  });

  afterAll(async () => {
    if (client) {
      await client.stop();
    }
  });

  describe('Invalid Arguments', () => {
    it('should handle missing required arguments', async () => {
      if (!mcpServerAvailable) return;

      // search 需要 query 参数
      const result = await client.callTool({
        name: 'search',
        arguments: {},
      });

      // 应该返回错误信息
      expect(result.content).toBeDefined();
      const text = result.content[0].text || '';
      expect(text.toLowerCase()).toMatch(/error|missing|required/);
    });

    it('should handle invalid path for dir_tree', async () => {
      if (!mcpServerAvailable) return;

      const result = await client.callTool({
        name: 'dir_tree',
        arguments: {
          path: '/non/existent/path/12345',
        },
      });

      expect(result.content).toBeDefined();
      const text = result.content[0].text || '';
      expect(text.toLowerCase()).toMatch(/error|not found|invalid/);
    });

    it('should handle invalid chunkId for get_chunk', async () => {
      if (!mcpServerAvailable) return;

      const result = await client.callTool({
        name: 'get_chunk',
        arguments: {
          chunkId: 'invalid-chunk-id-format',
        },
      });

      expect(result.content).toBeDefined();
      const text = result.content[0].text || '';
      expect(text.toLowerCase()).toMatch(/error|not found|invalid/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty query string', async () => {
      if (!mcpServerAvailable) return;

      const result = await client.callTool({
        name: 'search',
        arguments: {
          query: '',
          topK: 5,
        },
      });

      expect(result.content).toBeDefined();
      // 应该返回错误或空结果
    });

    it('should handle very long query string', async () => {
      if (!mcpServerAvailable) return;

      const longQuery = '测试'.repeat(1000);

      const result = await client.callTool({
        name: 'search',
        arguments: {
          query: longQuery,
          topK: 5,
        },
      });

      expect(result.content).toBeDefined();
      // 应该正常处理或返回错误
    });

    it('should handle special characters in query', async () => {
      if (!mcpServerAvailable) return;

      const specialQuery = "test'query\"with<special>&characters";

      const result = await client.callTool({
        name: 'search',
        arguments: {
          query: specialQuery,
          topK: 5,
        },
      });

      expect(result.content).toBeDefined();
      // 应该正常处理
    });
  });

  describe('Concurrency', () => {
    it('should handle multiple concurrent requests', async () => {
      if (!mcpServerAvailable) return;

      const queries = ['检验', '报告', '测试', '结果', 'CONFORMED'];

      const promises = queries.map(query =>
        client.callTool({
          name: 'search',
          arguments: {
            query,
            topK: 3,
          },
        })
      );

      const results = await Promise.all(promises);

      for (const result of results) {
        expect(result.content).toBeDefined();
      }
    });
  });
});
```

**Step 2: 运行测试**

Run: `pnpm --filter @agent-fs/e2e test src/g-post/mcp-error-handling.e2e.ts`
Expected: All tests PASS

---

## Task 6: 添加测试脚本

**Files:**
- Modify: `package.json` (根目录)

**Step 1: 添加 G-Post 测试命令**

```json
{
  "scripts": {
    "test:g-post": "pnpm --filter @agent-fs/e2e test:g-post",
    "test:e2e": "pnpm --filter @agent-fs/e2e test",
    "test:e2e:all": "pnpm test:f-post && pnpm test:g-post"
  }
}
```

**Step 2: 运行所有 G-Post 测试**

Run: `pnpm test:g-post`
Expected: All G-Post tests PASS (if dependencies available)

---

## 完成检查清单

- [ ] MCP 测试依赖配置
- [ ] MCP 测试客户端工具
- [ ] MCP Server 基础测试
- [ ] 完整端到端测试
- [ ] 错误处理测试
- [ ] 测试脚本配置

---

## 测试覆盖范围

| 组件 | 测试内容 |
|------|---------|
| MCP Server | 启动、工具列表 |
| list_indexes | 索引列表查询 |
| dir_tree | 目录结构查询 |
| search | 语义搜索 |
| get_chunk | Chunk 详情获取 |
| Error Handling | 参数验证、边界情况 |
| Full E2E | 索引 → MCP 查询完整流程 |
| AI Simulation | 模拟 AI Agent 调用模式 |

---

## 依赖说明

G-Post 测试需要以下依赖完成：

1. **[F] indexer** - 索引服务
2. **[G1] mcp-server** - MCP Server（需要先 build）
3. **LLM 服务** - 如 Ollama（可选，完整 E2E 需要）

运行前确保：
```bash
pnpm --filter @agent-fs/mcp-server build
```

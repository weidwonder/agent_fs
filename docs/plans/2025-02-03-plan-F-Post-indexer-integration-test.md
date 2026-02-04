# [F-Post] Indexer 集成测试实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 验证索引流程各组件集成，确保 scan → convert → chunk → summary → embed → store 链路正常

**Architecture:** 集成测试套件，使用真实测试数据验证各模块协作

**Tech Stack:** Vitest, TypeScript

**依赖:** Task 1-6 可立即执行（测试已完成组件）；Task 7-8 需要 LLM 服务可用

**检查点:** CP4 - Layer 5 验收

---

## 测试数据

```
test-data/
├── INDIR2511IN02996_D13&D15_origin.pdf     (4.5MB, PDF)
├── INDIR2511IN03148_D16&D17.md             (15KB, Markdown)
└── INDIR2512IN01019_D22,D23,F2,F3_origin.pdf (5.3MB, PDF)
```

---

## 成功标准

- [ ] Markdown 文件能正确解析和切分
- [ ] 所有 chunk 能正确生成
- [ ] 向量存储能正确写入和查询
- [ ] BM25 索引能正确构建和搜索
- [ ] 多路融合搜索返回正确结果
- [ ] SearchFusion.search() 完整流程正常工作
- [ ] BM25-only 结果能正确回查补全 summary/locator
- [ ] 索引元数据正确写入（需要 LLM）

---

## Task 1: 创建 E2E 测试包结构

**Files:**
- Create: `packages/e2e/package.json`
- Create: `packages/e2e/tsconfig.json`
- Create: `packages/e2e/vitest.config.ts`
- Create: `packages/e2e/src/index.ts`

**Step 1: 创建目录**

Run: `mkdir -p packages/e2e/src/utils`

**Step 2: 创建 package.json**

```json
{
  "name": "@agent-fs/e2e",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:f-post": "vitest run -t 'F-Post'",
    "test:g-post": "vitest run -t 'G-Post'"
  },
  "devDependencies": {
    "@agent-fs/core": "workspace:*",
    "@agent-fs/search": "workspace:*",
    "@agent-fs/llm": "workspace:*",
    "@agent-fs/plugin-markdown": "workspace:*",
    "@agent-fs/plugin-pdf": "workspace:*",
    "typescript": "^5.3.0",
    "vitest": "^4.0.18"
  }
}
```

**Step 3: 创建 tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../core" },
    { "path": "../search" },
    { "path": "../llm" },
    { "path": "../plugins/plugin-markdown" },
    { "path": "../plugins/plugin-pdf" }
  ]
}
```

**Step 4: 创建 vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.e2e.ts'],
    testTimeout: 120000,
    hookTimeout: 60000,
  },
});
```

**Step 5: 创建 index.ts**

```typescript
// packages/e2e/src/index.ts
export {};
```

**Step 6: 安装依赖**

Run: `pnpm install`

---

## Task 2: 创建测试工具函数

**Files:**
- Create: `packages/e2e/src/utils/test-config.ts`
- Create: `packages/e2e/src/utils/test-helpers.ts`

**Step 1: 创建测试配置**

```typescript
// packages/e2e/src/utils/test-config.ts
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export const TEST_DATA_DIR = join(__dirname, '../../../../test-data');

export const TEST_TEMP_PREFIX = 'agent-fs-e2e-';

export const TEST_FILES = {
  markdown: 'INDIR2511IN03148_D16&D17.md',
  pdf1: 'INDIR2511IN02996_D13&D15_origin.pdf',
  pdf2: 'INDIR2512IN01019_D22,D23,F2,F3_origin.pdf',
};

export const MOCK_CONFIG = {
  embedding: {
    default: 'api' as const,
    api: {
      base_url: 'http://localhost:11434/v1',
      api_key: 'ollama',
      model: 'nomic-embed-text',
    },
  },
  llm: {
    base_url: 'http://localhost:11434/v1',
    api_key: 'ollama',
    model: 'qwen2.5:7b',
  },
  indexing: {
    chunkSize: {
      minTokens: 200,
      maxTokens: 800,
    },
  },
};

export async function checkLLMAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${MOCK_CONFIG.llm.base_url}/models`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
```

**Step 2: 创建测试辅助函数**

```typescript
// packages/e2e/src/utils/test-helpers.ts
import { mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TEST_DATA_DIR, TEST_TEMP_PREFIX } from './test-config';

export function createTempTestDir(): string {
  const tempDir = join(
    tmpdir(),
    `${TEST_TEMP_PREFIX}${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

export function cleanupTempDir(tempDir: string): void {
  if (tempDir.includes(TEST_TEMP_PREFIX)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function copyTestFile(filename: string, tempDir: string): string {
  const srcPath = join(TEST_DATA_DIR, filename);
  const destPath = join(tempDir, filename);

  if (!existsSync(srcPath)) {
    throw new Error(`Test file not found: ${srcPath}`);
  }

  cpSync(srcPath, destPath);
  return destPath;
}

export function copyAllTestFiles(tempDir: string): void {
  cpSync(TEST_DATA_DIR, tempDir, { recursive: true });
}
```

---

## Task 3: Markdown 插件集成测试

**Files:**
- Create: `packages/e2e/src/f-post/markdown-plugin.e2e.ts`

**Step 1: 创建目录**

Run: `mkdir -p packages/e2e/src/f-post`

**Step 2: 编写测试**

```typescript
// packages/e2e/src/f-post/markdown-plugin.e2e.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { MarkdownPlugin } from '@agent-fs/plugin-markdown';
import { MarkdownChunker } from '@agent-fs/core';
import { TEST_FILES } from '../utils/test-config';
import { createTempTestDir, cleanupTempDir, copyTestFile } from '../utils/test-helpers';

describe('F-Post: Markdown Plugin Integration', () => {
  let tempDir: string;
  let plugin: MarkdownPlugin;

  beforeEach(() => {
    tempDir = createTempTestDir();
    plugin = new MarkdownPlugin();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('toMarkdown', () => {
    it('should convert markdown file and preserve content', async () => {
      const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

      const result = await plugin.toMarkdown(filePath);

      expect(result.markdown).toBeDefined();
      expect(result.markdown.length).toBeGreaterThan(0);
      expect(result.mapping).toBeDefined();
      expect(result.mapping.length).toBeGreaterThan(0);
    });

    it('should create valid position mappings', async () => {
      const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

      const result = await plugin.toMarkdown(filePath);

      for (const mapping of result.mapping) {
        expect(mapping.markdownRange.startLine).toBeGreaterThan(0);
        expect(mapping.markdownRange.endLine).toBeGreaterThanOrEqual(mapping.markdownRange.startLine);
        expect(mapping.originalLocator).toMatch(/^line:\d+(-\d+)?$/);
      }
    });
  });

  describe('parseLocator', () => {
    it('should parse single line locator', () => {
      const info = plugin.parseLocator('line:42');
      expect(info.displayText).toBe('第 42 行');
      expect(info.jumpInfo).toEqual({ line: 42 });
    });

    it('should parse line range locator', () => {
      const info = plugin.parseLocator('line:10-20');
      expect(info.displayText).toBe('第 10-20 行');
      expect(info.jumpInfo).toEqual({ startLine: 10, endLine: 20 });
    });
  });

  describe('chunking integration', () => {
    it('should chunk markdown content correctly', async () => {
      const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

      const result = await plugin.toMarkdown(filePath);
      const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
      const chunkResult = chunker.chunk(result.markdown);

      expect(chunkResult.chunks.length).toBeGreaterThan(0);

      for (const chunk of chunkResult.chunks) {
        expect(chunk.content).toBeDefined();
        expect(chunk.content.length).toBeGreaterThan(0);
        expect(chunk.locator).toBeDefined();
      }
    });

    it('should handle tables and special markdown elements', async () => {
      const filePath = copyTestFile(TEST_FILES.markdown, tempDir);
      const content = readFileSync(filePath, 'utf-8');

      expect(content).toContain('<table>');

      const result = await plugin.toMarkdown(filePath);
      const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
      const chunkResult = chunker.chunk(result.markdown);

      const hasTableContent = chunkResult.chunks.some(
        chunk => chunk.content.includes('table') || chunk.content.includes('|')
      );
      expect(hasTableContent).toBe(true);
    });
  });
});
```

**Step 3: 运行测试**

Run: `pnpm --filter @agent-fs/e2e test src/f-post/markdown-plugin.e2e.ts`
Expected: All tests PASS

---

## Task 4: BM25 搜索集成测试

**Files:**
- Create: `packages/e2e/src/f-post/bm25-search.e2e.ts`

**Step 1: 编写测试**

```typescript
// packages/e2e/src/f-post/bm25-search.e2e.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MarkdownPlugin } from '@agent-fs/plugin-markdown';
import { MarkdownChunker } from '@agent-fs/core';
import { BM25Index } from '@agent-fs/search';
import type { BM25Document } from '@agent-fs/core';
import { TEST_FILES } from '../utils/test-config';
import { createTempTestDir, cleanupTempDir, copyTestFile } from '../utils/test-helpers';

describe('F-Post: BM25 Search Integration', () => {
  let tempDir: string;
  let plugin: MarkdownPlugin;
  let index: BM25Index;

  beforeEach(() => {
    tempDir = createTempTestDir();
    plugin = new MarkdownPlugin();
    index = new BM25Index();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should index and search markdown content', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunkResult = chunker.chunk(result.markdown);

    const docs: BM25Document[] = chunkResult.chunks.map((chunk, i) => ({
      chunk_id: `test-chunk-${i}`,
      file_id: 'test-file-001',
      dir_id: 'test-dir-001',
      file_path: filePath,
      content: chunk.content,
      tokens: [],
      indexed_at: new Date().toISOString(),
      deleted_at: '',
    }));

    index.addDocuments(docs);

    // 中文搜索
    const results1 = index.search('检验报告', { topK: 5 });
    expect(results1.length).toBeGreaterThan(0);
    expect(results1[0].score).toBeGreaterThan(0);

    // 英文搜索
    const results2 = index.search('CONFORMED', { topK: 5 });
    expect(results2.length).toBeGreaterThan(0);

    // 产品名称搜索
    const results3 = index.search('SMART SPEAKER', { topK: 5 });
    expect(results3.length).toBeGreaterThan(0);
  });

  it('should handle soft delete correctly', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunkResult = chunker.chunk(result.markdown);

    const docs: BM25Document[] = chunkResult.chunks.slice(0, 3).map((chunk, i) => ({
      chunk_id: `delete-test-${i}`,
      file_id: 'test-file-001',
      dir_id: 'test-dir-001',
      file_path: filePath,
      content: chunk.content,
      tokens: [],
      indexed_at: new Date().toISOString(),
      deleted_at: '',
    }));

    index.addDocuments(docs);
    index.softDelete(['delete-test-0']);

    const afterDelete = index.search('检验', { topK: 10 });
    expect(afterDelete.find(r => r.chunk_id === 'delete-test-0')).toBeUndefined();
  });

  it('should filter by filePathPrefix', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunkResult = chunker.chunk(result.markdown);

    const docs: BM25Document[] = [
      {
        chunk_id: 'path-test-1',
        file_id: 'file-001',
        dir_id: 'dir-001',
        file_path: '/project/docs/report.md',
        content: chunkResult.chunks[0]?.content || '检验报告内容',
        tokens: [],
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      },
      {
        chunk_id: 'path-test-2',
        file_id: 'file-002',
        dir_id: 'dir-001',
        file_path: '/project/other/data.md',
        content: chunkResult.chunks[1]?.content || '其他检验数据',
        tokens: [],
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      },
    ];

    index.addDocuments(docs);

    const filtered = index.search('检验', {
      topK: 10,
      filePathPrefix: '/project/docs',
    });

    expect(filtered.length).toBe(1);
    expect(filtered[0].chunk_id).toBe('path-test-1');
  });
});
```

**Step 2: 运行测试**

Run: `pnpm --filter @agent-fs/e2e test src/f-post/bm25-search.e2e.ts`
Expected: All tests PASS

---

## Task 5: 向量存储集成测试

**Files:**
- Create: `packages/e2e/src/f-post/vector-store.e2e.ts`

**Step 1: 编写测试**

```typescript
// packages/e2e/src/f-post/vector-store.e2e.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MarkdownPlugin } from '@agent-fs/plugin-markdown';
import { MarkdownChunker } from '@agent-fs/core';
import { VectorStore } from '@agent-fs/search';
import type { VectorDocument } from '@agent-fs/core';
import { TEST_FILES } from '../utils/test-config';
import { createTempTestDir, cleanupTempDir, copyTestFile } from '../utils/test-helpers';

describe('F-Post: Vector Store Integration', () => {
  let tempDir: string;
  let storageDir: string;
  let plugin: MarkdownPlugin;
  let store: VectorStore;

  const DIMENSION = 8;

  function mockVector(content: string): number[] {
    const vector = new Array(DIMENSION).fill(0);
    for (let i = 0; i < content.length && i < DIMENSION * 10; i++) {
      vector[i % DIMENSION] += content.charCodeAt(i) / 1000;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return vector.map(v => v / (norm || 1));
  }

  beforeEach(async () => {
    tempDir = createTempTestDir();
    storageDir = createTempTestDir();
    plugin = new MarkdownPlugin();
    store = new VectorStore({
      storagePath: storageDir,
      dimension: DIMENSION,
    });
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    cleanupTempDir(tempDir);
    cleanupTempDir(storageDir);
  });

  it('should store and search vectors from markdown content', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunkResult = chunker.chunk(result.markdown);

    const docs: VectorDocument[] = chunkResult.chunks.slice(0, 5).map((chunk, i) => ({
      chunk_id: `vec-test-${i}`,
      file_id: 'vec-file-001',
      dir_id: 'vec-dir-001',
      rel_path: TEST_FILES.markdown,
      file_path: filePath,
      content: chunk.content,
      summary: `摘要 ${i}: ${chunk.content.slice(0, 50)}`,
      content_vector: mockVector(chunk.content),
      summary_vector: mockVector(`摘要 ${i}`),
      locator: chunk.locator,
      indexed_at: new Date().toISOString(),
      deleted_at: '',
    }));

    await store.addDocuments(docs);

    const count = await store.countRows();
    expect(count).toBe(5);

    const queryVector = mockVector(chunkResult.chunks[0].content);
    const results = await store.searchByContent(queryVector, { topK: 3 });

    expect(results.length).toBe(3);
    expect(results[0].chunk_id).toBe('vec-test-0');
    expect(results[0].score).toBeGreaterThan(0.9);
  });

  it('should filter by dirId', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunkResult = chunker.chunk(result.markdown);

    const docs: VectorDocument[] = [
      {
        chunk_id: 'dir-test-1',
        file_id: 'file-001',
        dir_id: 'dir-alpha',
        rel_path: 'a.md',
        file_path: '/alpha/a.md',
        content: chunkResult.chunks[0]?.content || 'content alpha',
        summary: 'summary alpha',
        content_vector: mockVector('content alpha'),
        summary_vector: mockVector('summary alpha'),
        locator: 'line:1-10',
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      },
      {
        chunk_id: 'dir-test-2',
        file_id: 'file-002',
        dir_id: 'dir-beta',
        rel_path: 'b.md',
        file_path: '/beta/b.md',
        content: chunkResult.chunks[1]?.content || 'content beta',
        summary: 'summary beta',
        content_vector: mockVector('content beta'),
        summary_vector: mockVector('summary beta'),
        locator: 'line:1-10',
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      },
    ];

    await store.addDocuments(docs);

    const filtered = await store.searchByContent(mockVector('content'), {
      topK: 10,
      dirId: 'dir-alpha',
    });

    expect(filtered.length).toBe(1);
    expect(filtered[0].document.dir_id).toBe('dir-alpha');
  });

  it('should handle soft delete and compact', async () => {
    const docs: VectorDocument[] = [
      {
        chunk_id: 'compact-test-1',
        file_id: 'file-001',
        dir_id: 'dir-001',
        rel_path: 'a.md',
        file_path: '/a.md',
        content: 'content 1',
        summary: 'summary 1',
        content_vector: mockVector('content 1'),
        summary_vector: mockVector('summary 1'),
        locator: 'line:1',
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      },
      {
        chunk_id: 'compact-test-2',
        file_id: 'file-002',
        dir_id: 'dir-001',
        rel_path: 'b.md',
        file_path: '/b.md',
        content: 'content 2',
        summary: 'summary 2',
        content_vector: mockVector('content 2'),
        summary_vector: mockVector('summary 2'),
        locator: 'line:1',
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      },
    ];

    await store.addDocuments(docs);
    await store.softDelete(['compact-test-1']);

    const results = await store.searchByContent(mockVector('content'), { topK: 10 });
    expect(results.find(r => r.chunk_id === 'compact-test-1')).toBeUndefined();

    const withDeleted = await store.searchByContent(mockVector('content'), {
      topK: 10,
      includeDeleted: true,
    });
    expect(withDeleted.find(r => r.chunk_id === 'compact-test-1')).toBeDefined();

    const removed = await store.compact();
    expect(removed).toBe(1);
  });
});
```

**Step 2: 运行测试**

Run: `pnpm --filter @agent-fs/e2e test src/f-post/vector-store.e2e.ts`
Expected: All tests PASS

---

## Task 6: 多路融合搜索集成测试

**Files:**
- Create: `packages/e2e/src/f-post/fusion-search.e2e.ts`

**Step 1: 编写测试**

```typescript
// packages/e2e/src/f-post/fusion-search.e2e.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MarkdownPlugin } from '@agent-fs/plugin-markdown';
import { MarkdownChunker } from '@agent-fs/core';
import { VectorStore, BM25Index, fusionRRF } from '@agent-fs/search';
import type { VectorDocument, BM25Document } from '@agent-fs/core';
import { TEST_FILES } from '../utils/test-config';
import { createTempTestDir, cleanupTempDir, copyTestFile } from '../utils/test-helpers';

describe('F-Post: Fusion Search Integration', () => {
  let tempDir: string;
  let storageDir: string;
  let plugin: MarkdownPlugin;
  let vectorStore: VectorStore;
  let bm25Index: BM25Index;

  const DIMENSION = 8;

  function mockVector(content: string): number[] {
    const vector = new Array(DIMENSION).fill(0);
    for (let i = 0; i < content.length && i < DIMENSION * 10; i++) {
      vector[i % DIMENSION] += content.charCodeAt(i) / 1000;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return vector.map(v => v / (norm || 1));
  }

  beforeEach(async () => {
    tempDir = createTempTestDir();
    storageDir = createTempTestDir();
    plugin = new MarkdownPlugin();
    vectorStore = new VectorStore({
      storagePath: storageDir,
      dimension: DIMENSION,
    });
    await vectorStore.init();
    bm25Index = new BM25Index();
  });

  afterEach(async () => {
    await vectorStore.close();
    cleanupTempDir(tempDir);
    cleanupTempDir(storageDir);
  });

  it('should fuse vector and BM25 results using RRF', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunkResult = chunker.chunk(result.markdown);

    const vectorDocs: VectorDocument[] = [];
    const bm25Docs: BM25Document[] = [];

    for (let i = 0; i < Math.min(chunkResult.chunks.length, 10); i++) {
      const chunk = chunkResult.chunks[i];
      const chunkId = `fusion-test-${i}`;

      vectorDocs.push({
        chunk_id: chunkId,
        file_id: 'fusion-file-001',
        dir_id: 'fusion-dir-001',
        rel_path: TEST_FILES.markdown,
        file_path: filePath,
        content: chunk.content,
        summary: `摘要 ${i}`,
        content_vector: mockVector(chunk.content),
        summary_vector: mockVector(`摘要 ${i}`),
        locator: chunk.locator,
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      });

      bm25Docs.push({
        chunk_id: chunkId,
        file_id: 'fusion-file-001',
        dir_id: 'fusion-dir-001',
        file_path: filePath,
        content: chunk.content,
        tokens: [],
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      });
    }

    await vectorStore.addDocuments(vectorDocs);
    bm25Index.addDocuments(bm25Docs);

    const queryVector = mockVector('检验报告 CONFORMED');
    const vectorResults = await vectorStore.searchByContent(queryVector, { topK: 5 });
    const bm25Results = bm25Index.search('检验报告', { topK: 5 });

    const fused = fusionRRF(
      [
        {
          name: 'vector',
          items: vectorResults.map(r => ({
            chunkId: r.chunk_id,
            score: r.score,
            content: r.document.content,
          })),
        },
        {
          name: 'bm25',
          items: bm25Results.map(r => ({
            chunkId: r.chunk_id,
            score: r.score,
            content: r.document.content,
          })),
        },
      ],
      (item) => item.chunkId
    );

    expect(fused.length).toBeGreaterThan(0);

    for (const result of fused) {
      expect(result.score).toBeGreaterThan(0);
      expect(result.sources.length).toBeGreaterThanOrEqual(1);
    }

    const multiSourceItems = fused.filter(r => r.sources.length > 1);
    const singleSourceItems = fused.filter(r => r.sources.length === 1);

    if (multiSourceItems.length > 0 && singleSourceItems.length > 0) {
      expect(multiSourceItems[0].score).toBeGreaterThanOrEqual(singleSourceItems[0].score);
    }
  });

  it('should handle empty results from one source', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunkResult = chunker.chunk(result.markdown);

    const bm25Docs: BM25Document[] = chunkResult.chunks.slice(0, 3).map((chunk, i) => ({
      chunk_id: `empty-test-${i}`,
      file_id: 'file-001',
      dir_id: 'dir-001',
      file_path: filePath,
      content: chunk.content,
      tokens: [],
      indexed_at: new Date().toISOString(),
      deleted_at: '',
    }));

    bm25Index.addDocuments(bm25Docs);

    const bm25Results = bm25Index.search('检验', { topK: 5 });

    const fused = fusionRRF(
      [
        { name: 'vector', items: [] },
        {
          name: 'bm25',
          items: bm25Results.map(r => ({
            chunkId: r.chunk_id,
            score: r.score,
          })),
        },
      ],
      (item) => item.chunkId
    );

    expect(fused.length).toBe(bm25Results.length);
    for (const result of fused) {
      expect(result.sources).toContain('bm25');
      expect(result.sources).not.toContain('vector');
    }
  });
});
```

**Step 2: 运行测试**

Run: `pnpm --filter @agent-fs/e2e test src/f-post/fusion-search.e2e.ts`
Expected: All tests PASS

---

## Task 6.5: SearchFusion 完整集成测试

**Files:**
- Create: `packages/e2e/src/f-post/search-fusion-complete.e2e.ts`

**Step 1: 编写测试**

```typescript
// packages/e2e/src/f-post/search-fusion-complete.e2e.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MarkdownPlugin } from '@agent-fs/plugin-markdown';
import { MarkdownChunker } from '@agent-fs/core';
import { VectorStore, BM25Index, createSearchFusion } from '@agent-fs/search';
import type { VectorDocument, BM25Document } from '@agent-fs/core';
import type { EmbeddingService } from '@agent-fs/llm';
import { TEST_FILES } from '../utils/test-config';
import { createTempTestDir, cleanupTempDir, copyTestFile } from '../utils/test-helpers';

describe('F-Post: SearchFusion Complete Integration', () => {
  let tempDir: string;
  let storageDir: string;
  let plugin: MarkdownPlugin;
  let vectorStore: VectorStore;
  let bm25Index: BM25Index;

  const DIMENSION = 8;

  function mockVector(content: string): number[] {
    const vector = new Array(DIMENSION).fill(0);
    for (let i = 0; i < content.length && i < DIMENSION * 10; i++) {
      vector[i % DIMENSION] += content.charCodeAt(i) / 1000;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return vector.map(v => v / (norm || 1));
  }

  // Mock embedding service
  const mockEmbeddingService: EmbeddingService = {
    embed: async (text: string) => mockVector(text),
    embedBatch: async (texts: string[]) => texts.map(mockVector),
    getDimension: () => DIMENSION,
    init: async () => {},
    dispose: async () => {},
  };

  beforeEach(async () => {
    tempDir = createTempTestDir();
    storageDir = createTempTestDir();
    plugin = new MarkdownPlugin();
    vectorStore = new VectorStore({
      storagePath: storageDir,
      dimension: DIMENSION,
    });
    await vectorStore.init();
    bm25Index = new BM25Index();
  });

  afterEach(async () => {
    await vectorStore.close();
    cleanupTempDir(tempDir);
    cleanupTempDir(storageDir);
  });

  it('should perform complete SearchFusion.search() with mock embedding', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunkResult = chunker.chunk(result.markdown);

    const vectorDocs: VectorDocument[] = [];
    const bm25Docs: BM25Document[] = [];

    for (let i = 0; i < Math.min(chunkResult.chunks.length, 10); i++) {
      const chunk = chunkResult.chunks[i];
      const chunkId = `search-fusion-${i}`;

      vectorDocs.push({
        chunk_id: chunkId,
        file_id: 'sf-file-001',
        dir_id: 'sf-dir-001',
        rel_path: TEST_FILES.markdown,
        file_path: filePath,
        content: chunk.content,
        summary: `摘要 ${i}: ${chunk.content.slice(0, 30)}`,
        content_vector: mockVector(chunk.content),
        summary_vector: mockVector(`摘要 ${i}`),
        locator: chunk.locator,
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      });

      bm25Docs.push({
        chunk_id: chunkId,
        file_id: 'sf-file-001',
        dir_id: 'sf-dir-001',
        file_path: filePath,
        content: chunk.content,
        tokens: [],
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      });
    }

    await vectorStore.addDocuments(vectorDocs);
    bm25Index.addDocuments(bm25Docs);

    // 使用 SearchFusion 进行搜索
    const fusion = createSearchFusion(vectorStore, bm25Index, mockEmbeddingService);

    const response = await fusion.search({
      query: '检验报告 CONFORMED',
      topK: 5,
    });

    // 验证结果
    expect(response.results.length).toBeGreaterThan(0);
    expect(response.results.length).toBeLessThanOrEqual(5);
    expect(response.meta.fusionMethod).toBe('rrf');
    expect(response.meta.totalSearched).toBeGreaterThan(0);
    expect(response.meta.elapsedMs).toBeGreaterThanOrEqual(0);

    // 验证结果结构
    for (const result of response.results) {
      expect(result.chunkId).toBeDefined();
      expect(result.score).toBeGreaterThan(0);
      expect(result.content).toBeDefined();
      expect(result.source.filePath).toBeDefined();
    }
  });

  it('should use keyword for BM25 when provided', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunkResult = chunker.chunk(result.markdown);

    const bm25Docs: BM25Document[] = chunkResult.chunks.slice(0, 5).map((chunk, i) => ({
      chunk_id: `keyword-test-${i}`,
      file_id: 'file-001',
      dir_id: 'dir-001',
      file_path: filePath,
      content: chunk.content,
      tokens: [],
      indexed_at: new Date().toISOString(),
      deleted_at: '',
    }));

    bm25Index.addDocuments(bm25Docs);

    const fusion = createSearchFusion(vectorStore, bm25Index, mockEmbeddingService);

    // 使用 keyword 参数
    const response = await fusion.search(
      {
        query: 'semantic query for vectors',
        keyword: '检验报告',
        topK: 5,
      },
      {
        useContentVector: false,
        useSummaryVector: false,
        useBM25: true,
      }
    );

    expect(response.results.length).toBeGreaterThan(0);
  });

  it('should backfill summary/locator for BM25-only results', async () => {
    const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

    const result = await plugin.toMarkdown(filePath);
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
    const chunkResult = chunker.chunk(result.markdown);

    // 只在 VectorStore 中存储完整信息
    const vectorDocs: VectorDocument[] = chunkResult.chunks.slice(0, 3).map((chunk, i) => ({
      chunk_id: `backfill-test-${i}`,
      file_id: 'file-001',
      dir_id: 'dir-001',
      rel_path: TEST_FILES.markdown,
      file_path: filePath,
      content: chunk.content,
      summary: `完整摘要 ${i}`,
      content_vector: mockVector(chunk.content),
      summary_vector: mockVector(`摘要 ${i}`),
      locator: chunk.locator,
      indexed_at: new Date().toISOString(),
      deleted_at: '',
    }));

    // BM25 中存储同样的 chunks
    const bm25Docs: BM25Document[] = chunkResult.chunks.slice(0, 3).map((chunk, i) => ({
      chunk_id: `backfill-test-${i}`,
      file_id: 'file-001',
      dir_id: 'dir-001',
      file_path: filePath,
      content: chunk.content,
      tokens: [],
      indexed_at: new Date().toISOString(),
      deleted_at: '',
    }));

    await vectorStore.addDocuments(vectorDocs);
    bm25Index.addDocuments(bm25Docs);

    const fusion = createSearchFusion(vectorStore, bm25Index, mockEmbeddingService);

    // 只使用 BM25 搜索，应该回查补全 summary/locator
    const response = await fusion.search(
      { query: '检验', topK: 3 },
      { useContentVector: false, useSummaryVector: false, useBM25: true }
    );

    // 验证 summary 和 locator 被补全
    for (const result of response.results) {
      expect(result.summary).toContain('完整摘要');
      expect(result.source.locator).toBeDefined();
      expect(result.source.locator.length).toBeGreaterThan(0);
    }
  });
});
```

**Step 2: 运行测试**

Run: `pnpm --filter @agent-fs/e2e test src/f-post/search-fusion-complete.e2e.ts`
Expected: All tests PASS

---

## Task 7: 完整索引流水线测试（需要 LLM）

**Files:**
- Create: `packages/e2e/src/f-post/full-pipeline.e2e.ts`

**Step 1: 编写测试**

```typescript
// packages/e2e/src/f-post/full-pipeline.e2e.ts
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { MarkdownPlugin } from '@agent-fs/plugin-markdown';
import { MarkdownChunker } from '@agent-fs/core';
import { createEmbeddingService, createSummaryService } from '@agent-fs/llm';
import { VectorStore, BM25Index, fusionRRF } from '@agent-fs/search';
import type { VectorDocument, BM25Document } from '@agent-fs/core';
import { TEST_FILES, MOCK_CONFIG, checkLLMAvailable } from '../utils/test-config';
import { createTempTestDir, cleanupTempDir, copyTestFile } from '../utils/test-helpers';

describe('F-Post: Full Indexing Pipeline', () => {
  let llmAvailable: boolean;

  beforeAll(async () => {
    llmAvailable = await checkLLMAvailable();
    if (!llmAvailable) {
      console.warn('⚠️ LLM service not available. Skipping full pipeline tests.');
    }
  });

  describe('with LLM service', () => {
    let tempDir: string;
    let storageDir: string;

    beforeEach(() => {
      tempDir = createTempTestDir();
      storageDir = createTempTestDir();
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
      cleanupTempDir(storageDir);
    });

    it('should complete full indexing pipeline for markdown', async () => {
      if (!llmAvailable) {
        console.log('Skipping: LLM service not available');
        return;
      }

      const filePath = copyTestFile(TEST_FILES.markdown, tempDir);

      const embeddingService = createEmbeddingService(MOCK_CONFIG.embedding);
      await embeddingService.init();

      const summaryService = createSummaryService(MOCK_CONFIG.llm);

      const dimension = embeddingService.getDimension();
      const vectorStore = new VectorStore({
        storagePath: storageDir,
        dimension,
      });
      await vectorStore.init();

      const bm25Index = new BM25Index();

      try {
        const plugin = new MarkdownPlugin();
        const conversionResult = await plugin.toMarkdown(filePath);

        const chunker = new MarkdownChunker({
          minTokens: MOCK_CONFIG.indexing.chunkSize.minTokens,
          maxTokens: MOCK_CONFIG.indexing.chunkSize.maxTokens,
        });
        const chunkResult = chunker.chunk(conversionResult.markdown);

        expect(chunkResult.chunks.length).toBeGreaterThan(0);

        const vectorDocs: VectorDocument[] = [];
        const bm25Docs: BM25Document[] = [];

        for (let i = 0; i < Math.min(chunkResult.chunks.length, 3); i++) {
          const chunk = chunkResult.chunks[i];
          const chunkId = `full-pipeline-${i}`;

          const summaryResult = await summaryService.generateChunkSummary(chunk.content);
          expect(summaryResult.summary).toBeDefined();
          expect(summaryResult.summary.length).toBeGreaterThan(0);

          const contentVector = await embeddingService.embed(chunk.content);
          const summaryVector = await embeddingService.embed(summaryResult.summary);

          expect(contentVector.length).toBe(dimension);
          expect(summaryVector.length).toBe(dimension);

          vectorDocs.push({
            chunk_id: chunkId,
            file_id: 'pipeline-file-001',
            dir_id: 'pipeline-dir-001',
            rel_path: TEST_FILES.markdown,
            file_path: filePath,
            content: chunk.content,
            summary: summaryResult.summary,
            content_vector: contentVector,
            summary_vector: summaryVector,
            locator: chunk.locator,
            indexed_at: new Date().toISOString(),
            deleted_at: '',
          });

          bm25Docs.push({
            chunk_id: chunkId,
            file_id: 'pipeline-file-001',
            dir_id: 'pipeline-dir-001',
            file_path: filePath,
            content: chunk.content,
            tokens: [],
            indexed_at: new Date().toISOString(),
            deleted_at: '',
          });
        }

        await vectorStore.addDocuments(vectorDocs);
        bm25Index.addDocuments(bm25Docs);

        const queryVector = await embeddingService.embed('检验报告结果');

        const vectorResults = await vectorStore.searchByContent(queryVector, { topK: 3 });
        const bm25Results = bm25Index.search('检验报告', { topK: 3 });

        expect(vectorResults.length).toBeGreaterThan(0);
        expect(bm25Results.length).toBeGreaterThan(0);

        const fused = fusionRRF(
          [
            {
              name: 'vector',
              items: vectorResults.map(r => ({ chunkId: r.chunk_id, score: r.score })),
            },
            {
              name: 'bm25',
              items: bm25Results.map(r => ({ chunkId: r.chunk_id, score: r.score })),
            },
          ],
          (item) => item.chunkId
        );

        expect(fused.length).toBeGreaterThan(0);

        console.log('✅ Full pipeline completed successfully');
        console.log(`   - Chunks processed: ${vectorDocs.length}`);
        console.log(`   - Vector search results: ${vectorResults.length}`);
        console.log(`   - BM25 search results: ${bm25Results.length}`);
        console.log(`   - Fused results: ${fused.length}`);
      } finally {
        await vectorStore.close();
        await embeddingService.dispose();
      }
    }, 180000);
  });
});
```

**Step 2: 运行测试**

Run: `pnpm --filter @agent-fs/e2e test src/f-post/full-pipeline.e2e.ts`
Expected: PASS (if LLM available) or SKIP

---

## Task 8: 添加测试脚本

**Files:**
- Modify: `package.json` (根目录)

**Step 1: 添加 F-Post 测试命令**

在根目录 `package.json` 的 `scripts` 中添加：

```json
{
  "scripts": {
    "test:f-post": "pnpm --filter @agent-fs/e2e test:f-post"
  }
}
```

**Step 2: 运行所有 F-Post 测试**

Run: `pnpm test:f-post`
Expected: All F-Post tests PASS

---

## 完成检查清单

- [ ] E2E 测试包结构
- [ ] 测试工具函数
- [ ] Markdown 插件集成测试
- [ ] BM25 搜索集成测试
- [ ] 向量存储集成测试
- [ ] 多路融合搜索测试（RRF 算法）
- [ ] SearchFusion 完整集成测试
- [ ] 完整流水线测试（需要 LLM）
- [ ] 测试脚本配置

---

## 测试覆盖范围

| 组件 | 测试内容 |
|------|---------|
| Markdown Plugin | 文件读取、转换、位置映射 |
| Chunker | 切分验证、特殊元素处理 |
| BM25 Index | 中英文搜索、软删除、路径过滤 |
| Vector Store | 存储、搜索、过滤、压缩 |
| RRF Fusion | 多路融合、空结果处理 |
| SearchFusion | 完整搜索流程、keyword 参数、BM25 回查补全 |
| Full Pipeline | 完整索引流程验证（需要 LLM） |

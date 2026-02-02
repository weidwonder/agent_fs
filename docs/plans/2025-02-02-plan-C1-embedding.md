# [C1] Embedding - Embedding 服务实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 Embedding 服务，支持本地模型和 OpenAI 兼容 API

**Architecture:** 统一接口封装，支持本地 ONNX 模型和远程 API，带缓存机制

**Tech Stack:** @xenova/transformers (本地), OpenAI API (远程), LRU 缓存

**依赖:** [A] foundation, [B1] config

**被依赖:** [D] vector-store, [F] indexer

---

## 成功标准

- [ ] 本地模型可加载并生成 embedding
- [ ] API 模式可调用 OpenAI 兼容接口
- [ ] 缓存命中时不重复计算
- [ ] 支持批量 embedding
- [ ] 单元测试覆盖率 > 80%

---

## Task 1: 创建 llm 包结构

**Files:**
- Create: `packages/llm/package.json`
- Create: `packages/llm/tsconfig.json`
- Create: `packages/llm/src/index.ts`
- Create: `packages/llm/src/embedding/index.ts`

**Step 1: 创建目录**

Run: `mkdir -p packages/llm/src/embedding`
Expected: 目录创建成功

**Step 2: 创建 packages/llm/package.json**

```json
{
  "name": "@agent-fs/llm",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "lint": "eslint src",
    "test": "vitest run"
  },
  "dependencies": {
    "@agent-fs/core": "workspace:*",
    "@xenova/transformers": "^2.17.0",
    "lru-cache": "^10.2.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

**Step 3: 创建 packages/llm/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [
    { "path": "../core" }
  ]
}
```

**Step 4: 创建占位文件**

```typescript
// packages/llm/src/index.ts
export const VERSION = '0.1.0';

// Embedding
export { EmbeddingService, createEmbeddingService } from './embedding';
export type { EmbeddingOptions, EmbeddingResult } from './embedding';
```

**Step 5: 安装依赖**

Run: `pnpm install`
Expected: 成功安装

**Step 6: Commit**

```bash
git add packages/llm
git commit -m "chore: create @agent-fs/llm package structure"
```

---

## Task 2: 实现缓存层

**Files:**
- Create: `packages/llm/src/embedding/cache.ts`

**Step 1: 创建 cache.ts**

```typescript
import { LRUCache } from 'lru-cache';
import { createHash } from 'node:crypto';

/**
 * Embedding 缓存
 */
export class EmbeddingCache {
  private cache: LRUCache<string, number[]>;
  private model: string;

  constructor(model: string, maxSize: number = 10000) {
    this.model = model;
    this.cache = new LRUCache({
      max: maxSize,
      // 估算每个 embedding 占用的内存（假设 512 维 float32）
      sizeCalculation: (value) => value.length * 4,
      maxSize: 100 * 1024 * 1024, // 100MB
    });
  }

  /**
   * 生成缓存键
   */
  private makeKey(text: string): string {
    const hash = createHash('sha256').update(text).digest('hex');
    return `${this.model}:${hash}`;
  }

  /**
   * 获取缓存的 embedding
   */
  get(text: string): number[] | undefined {
    return this.cache.get(this.makeKey(text));
  }

  /**
   * 存储 embedding
   */
  set(text: string, embedding: number[]): void {
    this.cache.set(this.makeKey(text), embedding);
  }

  /**
   * 批量获取
   */
  getMany(texts: string[]): (number[] | undefined)[] {
    return texts.map((text) => this.get(text));
  }

  /**
   * 批量存储
   */
  setMany(texts: string[], embeddings: number[][]): void {
    for (let i = 0; i < texts.length; i++) {
      this.set(texts[i], embeddings[i]);
    }
  }

  /**
   * 获取缓存统计
   */
  get stats() {
    return {
      size: this.cache.size,
      calculatedSize: this.cache.calculatedSize,
    };
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }
}
```

**Step 2: 验证编译**

Run: `pnpm --filter @agent-fs/llm build`
Expected: 编译成功

**Step 3: Commit**

```bash
git add packages/llm/src/embedding/cache.ts
git commit -m "feat(llm): add embedding cache with LRU"
```

---

## Task 3: 实现本地 Embedding 提供者

**Files:**
- Create: `packages/llm/src/embedding/local-provider.ts`

**Step 1: 创建 local-provider.ts**

```typescript
import { pipeline, type Pipeline } from '@xenova/transformers';

/**
 * 本地 Embedding 提供者选项
 */
export interface LocalEmbeddingOptions {
  /** 模型名称 */
  model: string;

  /** 设备 */
  device?: 'cpu' | 'gpu';

  /** 模型缓存目录 */
  cacheDir?: string;
}

/**
 * 本地 Embedding 提供者
 * 使用 transformers.js 运行 ONNX 模型
 */
export class LocalEmbeddingProvider {
  private options: LocalEmbeddingOptions;
  private pipeline: Pipeline | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(options: LocalEmbeddingOptions) {
    this.options = {
      device: 'cpu',
      ...options,
    };
  }

  /**
   * 初始化模型
   */
  async init(): Promise<void> {
    if (this.pipeline) return;

    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = this.loadModel();
    await this.initPromise;
  }

  private async loadModel(): Promise<void> {
    console.log(`Loading embedding model: ${this.options.model}`);

    this.pipeline = await pipeline('feature-extraction', this.options.model, {
      // quantized: true, // 使用量化模型减少内存
    });

    console.log('Embedding model loaded');
  }

  /**
   * 生成单个文本的 embedding
   */
  async embed(text: string): Promise<number[]> {
    await this.init();

    if (!this.pipeline) {
      throw new Error('Pipeline not initialized');
    }

    const result = await this.pipeline(text, {
      pooling: 'mean',
      normalize: true,
    });

    return Array.from(result.data as Float32Array);
  }

  /**
   * 批量生成 embedding
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.init();

    if (!this.pipeline) {
      throw new Error('Pipeline not initialized');
    }

    const results: number[][] = [];

    // transformers.js 目前不支持真正的批处理
    // 逐个处理
    for (const text of texts) {
      const result = await this.pipeline(text, {
        pooling: 'mean',
        normalize: true,
      });
      results.push(Array.from(result.data as Float32Array));
    }

    return results;
  }

  /**
   * 获取向量维度
   */
  async getDimension(): Promise<number> {
    const sample = await this.embed('test');
    return sample.length;
  }

  /**
   * 释放资源
   */
  async dispose(): Promise<void> {
    this.pipeline = null;
    this.initPromise = null;
  }
}
```

**Step 2: 验证编译**

Run: `pnpm --filter @agent-fs/llm build`
Expected: 编译成功

**Step 3: Commit**

```bash
git add packages/llm/src/embedding/local-provider.ts
git commit -m "feat(llm): add local embedding provider with transformers.js"
```

---

## Task 4: 实现 API Embedding 提供者

**Files:**
- Create: `packages/llm/src/embedding/api-provider.ts`

**Step 1: 创建 api-provider.ts**

```typescript
/**
 * API Embedding 提供者选项
 */
export interface APIEmbeddingOptions {
  /** API 地址 */
  baseUrl: string;

  /** API 密钥 */
  apiKey: string;

  /** 模型名称 */
  model: string;

  /** 请求超时（毫秒） */
  timeout?: number;

  /** 最大重试次数 */
  maxRetries?: number;
}

/**
 * OpenAI 兼容的 API Embedding 提供者
 */
export class APIEmbeddingProvider {
  private options: Required<APIEmbeddingOptions>;

  constructor(options: APIEmbeddingOptions) {
    this.options = {
      timeout: 30000,
      maxRetries: 3,
      ...options,
    };
  }

  /**
   * 生成单个文本的 embedding
   */
  async embed(text: string): Promise<number[]> {
    const embeddings = await this.embedBatch([text]);
    return embeddings[0];
  }

  /**
   * 批量生成 embedding
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const url = `${this.options.baseUrl}/embeddings`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.options.apiKey}`,
          },
          body: JSON.stringify({
            model: this.options.model,
            input: texts,
          }),
          signal: AbortSignal.timeout(this.options.timeout),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`API error: ${response.status} ${error}`);
        }

        const data = await response.json();

        // OpenAI API 格式
        interface EmbeddingResponse {
          data: Array<{
            embedding: number[];
            index: number;
          }>;
        }

        const result = data as EmbeddingResponse;

        // 按 index 排序后返回
        return result.data
          .sort((a, b) => a.index - b.index)
          .map((item) => item.embedding);
      } catch (error) {
        lastError = error as Error;

        // 指数退避
        if (attempt < this.options.maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError ?? new Error('Failed to generate embeddings');
  }

  /**
   * 获取向量维度（需要先调用一次 API）
   */
  async getDimension(): Promise<number> {
    const sample = await this.embed('test');
    return sample.length;
  }

  /**
   * 初始化（API 模式无需初始化）
   */
  async init(): Promise<void> {
    // 可以在这里验证 API 可用性
  }

  /**
   * 释放资源（API 模式无需清理）
   */
  async dispose(): Promise<void> {
    // 无需清理
  }
}
```

**Step 2: 验证编译**

Run: `pnpm --filter @agent-fs/llm build`
Expected: 编译成功

**Step 3: Commit**

```bash
git add packages/llm/src/embedding/api-provider.ts
git commit -m "feat(llm): add API embedding provider for OpenAI compatible APIs"
```

---

## Task 5: 实现 EmbeddingService

**Files:**
- Create: `packages/llm/src/embedding/service.ts`

**Step 1: 创建 service.ts**

```typescript
import type { EmbeddingConfig } from '@agent-fs/core';
import { EmbeddingCache } from './cache';
import { LocalEmbeddingProvider } from './local-provider';
import { APIEmbeddingProvider } from './api-provider';

/**
 * Embedding 选项
 */
export interface EmbeddingOptions {
  /** 是否使用缓存 */
  useCache?: boolean;

  /** 批处理大小 */
  batchSize?: number;
}

/**
 * Embedding 结果
 */
export interface EmbeddingResult {
  /** 向量列表 */
  embeddings: number[][];

  /** 缓存命中数 */
  cacheHits: number;

  /** API/模型调用数 */
  computations: number;
}

/**
 * Embedding 提供者接口
 */
interface EmbeddingProvider {
  init(): Promise<void>;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimension(): Promise<number>;
  dispose(): Promise<void>;
}

/**
 * Embedding 服务
 * 统一封装本地模型和 API 调用
 */
export class EmbeddingService {
  private provider: EmbeddingProvider;
  private cache: EmbeddingCache;
  private modelName: string;
  private dimension: number | null = null;

  constructor(config: EmbeddingConfig) {
    // 根据配置选择提供者
    if (config.default === 'local' && config.local) {
      this.modelName = config.local.model;
      this.provider = new LocalEmbeddingProvider({
        model: config.local.model,
        device: config.local.device,
      });
    } else if (config.api) {
      this.modelName = config.api.model;
      this.provider = new APIEmbeddingProvider({
        baseUrl: config.api.baseUrl,
        apiKey: config.api.apiKey,
        model: config.api.model,
      });
    } else {
      throw new Error('No valid embedding configuration provided');
    }

    this.cache = new EmbeddingCache(this.modelName);
  }

  /**
   * 初始化服务
   */
  async init(): Promise<void> {
    await this.provider.init();
    this.dimension = await this.provider.getDimension();
  }

  /**
   * 获取向量维度
   */
  getDimension(): number {
    if (this.dimension === null) {
      throw new Error('Service not initialized. Call init() first.');
    }
    return this.dimension;
  }

  /**
   * 生成单个文本的 embedding
   */
  async embed(text: string, options: EmbeddingOptions = {}): Promise<number[]> {
    const { useCache = true } = options;

    // 检查缓存
    if (useCache) {
      const cached = this.cache.get(text);
      if (cached) {
        return cached;
      }
    }

    // 计算 embedding
    const embedding = await this.provider.embed(text);

    // 存入缓存
    if (useCache) {
      this.cache.set(text, embedding);
    }

    return embedding;
  }

  /**
   * 批量生成 embedding
   */
  async embedBatch(texts: string[], options: EmbeddingOptions = {}): Promise<EmbeddingResult> {
    const { useCache = true, batchSize = 32 } = options;

    const results: (number[] | null)[] = new Array(texts.length).fill(null);
    let cacheHits = 0;
    let computations = 0;

    // 检查缓存，收集需要计算的索引
    const toCompute: { index: number; text: string }[] = [];

    for (let i = 0; i < texts.length; i++) {
      if (useCache) {
        const cached = this.cache.get(texts[i]);
        if (cached) {
          results[i] = cached;
          cacheHits++;
          continue;
        }
      }
      toCompute.push({ index: i, text: texts[i] });
    }

    // 批量计算
    for (let i = 0; i < toCompute.length; i += batchSize) {
      const batch = toCompute.slice(i, i + batchSize);
      const batchTexts = batch.map((item) => item.text);

      const embeddings = await this.provider.embedBatch(batchTexts);
      computations += embeddings.length;

      for (let j = 0; j < batch.length; j++) {
        const { index, text } = batch[j];
        results[index] = embeddings[j];

        if (useCache) {
          this.cache.set(text, embeddings[j]);
        }
      }
    }

    return {
      embeddings: results as number[][],
      cacheHits,
      computations,
    };
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return this.cache.stats;
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 释放资源
   */
  async dispose(): Promise<void> {
    await this.provider.dispose();
    this.cache.clear();
  }
}

/**
 * 创建 Embedding 服务
 */
export function createEmbeddingService(config: EmbeddingConfig): EmbeddingService {
  return new EmbeddingService(config);
}
```

**Step 2: 更新 embedding/index.ts**

```typescript
// Embedding module exports
export { EmbeddingService, createEmbeddingService } from './service';
export type { EmbeddingOptions, EmbeddingResult } from './service';
export { EmbeddingCache } from './cache';
export { LocalEmbeddingProvider, type LocalEmbeddingOptions } from './local-provider';
export { APIEmbeddingProvider, type APIEmbeddingOptions } from './api-provider';
```

**Step 3: 验证编译**

Run: `pnpm --filter @agent-fs/llm build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add packages/llm/src/embedding
git commit -m "feat(llm): add EmbeddingService with cache and batch support"
```

---

## Task 6: 编写单元测试

**Files:**
- Create: `packages/llm/src/embedding/cache.test.ts`
- Create: `packages/llm/src/embedding/service.test.ts`

**Step 1: 创建 cache.test.ts**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { EmbeddingCache } from './cache';

describe('EmbeddingCache', () => {
  let cache: EmbeddingCache;

  beforeEach(() => {
    cache = new EmbeddingCache('test-model');
  });

  it('should store and retrieve embeddings', () => {
    const embedding = [1, 2, 3, 4, 5];
    cache.set('hello', embedding);
    expect(cache.get('hello')).toEqual(embedding);
  });

  it('should return undefined for missing keys', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('should use model name in cache key', () => {
    const cache1 = new EmbeddingCache('model-a');
    const cache2 = new EmbeddingCache('model-b');

    cache1.set('hello', [1, 2, 3]);
    cache2.set('hello', [4, 5, 6]);

    // 不同模型的缓存应该独立
    expect(cache1.get('hello')).toEqual([1, 2, 3]);
    expect(cache2.get('hello')).toEqual([4, 5, 6]);
  });

  it('should handle batch operations', () => {
    const texts = ['a', 'b', 'c'];
    const embeddings = [[1], [2], [3]];

    cache.setMany(texts, embeddings);

    const results = cache.getMany(texts);
    expect(results).toEqual(embeddings);
  });

  it('should clear cache', () => {
    cache.set('hello', [1, 2, 3]);
    cache.clear();
    expect(cache.get('hello')).toBeUndefined();
  });

  it('should track stats', () => {
    cache.set('a', [1, 2, 3]);
    cache.set('b', [4, 5, 6]);

    expect(cache.stats.size).toBe(2);
  });
});
```

**Step 2: 创建 service.test.ts**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingService } from './service';
import type { EmbeddingConfig } from '@agent-fs/core';

// Mock API provider
vi.mock('./api-provider', () => ({
  APIEmbeddingProvider: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    embed: vi.fn().mockImplementation((text: string) =>
      Promise.resolve(new Array(512).fill(0).map((_, i) => i + text.length))
    ),
    embedBatch: vi.fn().mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map((text) => new Array(512).fill(0).map((_, i) => i + text.length)))
    ),
    getDimension: vi.fn().mockResolvedValue(512),
    dispose: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('EmbeddingService', () => {
  const apiConfig: EmbeddingConfig = {
    default: 'api',
    api: {
      provider: 'openai-compatible',
      baseUrl: 'https://api.test.com/v1',
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
    },
  };

  let service: EmbeddingService;

  beforeEach(async () => {
    service = new EmbeddingService(apiConfig);
    await service.init();
  });

  it('should initialize and get dimension', () => {
    expect(service.getDimension()).toBe(512);
  });

  it('should generate embedding for single text', async () => {
    const embedding = await service.embed('hello');
    expect(embedding).toHaveLength(512);
  });

  it('should cache embeddings', async () => {
    const text = 'cached text';

    // First call
    await service.embed(text);

    // Second call should hit cache
    const result = await service.embedBatch([text]);
    expect(result.cacheHits).toBe(1);
    expect(result.computations).toBe(0);
  });

  it('should handle batch embedding', async () => {
    const texts = ['a', 'b', 'c'];
    const result = await service.embedBatch(texts);

    expect(result.embeddings).toHaveLength(3);
    expect(result.computations).toBe(3);
  });

  it('should bypass cache when disabled', async () => {
    const text = 'no cache';

    await service.embed(text, { useCache: false });
    const result = await service.embedBatch([text], { useCache: false });

    expect(result.cacheHits).toBe(0);
    expect(result.computations).toBe(1);
  });

  it('should clear cache', async () => {
    await service.embed('text');
    service.clearCache();

    expect(service.getCacheStats().size).toBe(0);
  });
});
```

**Step 3: 运行测试**

Run: `pnpm --filter @agent-fs/llm test`
Expected: 测试通过

**Step 4: Commit**

```bash
git add packages/llm/src/embedding/*.test.ts
git commit -m "test(llm): add embedding cache and service tests"
```

---

## Task 7: 更新根 tsconfig.json

**Files:**
- Modify: `tsconfig.json`

**Step 1: 添加 llm 包引用**

```json
{
  "files": [],
  "references": [
    { "path": "packages/core" },
    { "path": "packages/search" },
    { "path": "packages/llm" },
    { "path": "packages/plugins/plugin-markdown" },
    { "path": "packages/plugins/plugin-pdf" }
  ]
}
```

**Step 2: 验证编译**

Run: `pnpm build`
Expected: 编译成功

**Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "chore: add llm package to project references"
```

---

## Task 8: 最终验证

**Step 1: 完整构建**

Run: `pnpm build`
Expected: 编译成功

**Step 2: 运行所有测试**

Run: `pnpm test`
Expected: 所有测试通过

---

## 完成检查清单

- [ ] 本地模型提供者实现
- [ ] API 提供者实现
- [ ] 缓存机制工作正常
- [ ] 批量处理支持
- [ ] 测试覆盖率 > 80%

---

## 输出接口

```typescript
// 从 @agent-fs/llm 导入
import { EmbeddingService, createEmbeddingService } from '@agent-fs/llm';

// 使用示例
const service = createEmbeddingService({
  default: 'api',
  api: {
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'text-embedding-3-small',
  },
});

await service.init();

const embedding = await service.embed('Hello world');
const batchResult = await service.embedBatch(['text1', 'text2'], { batchSize: 32 });

console.log('Dimension:', service.getDimension());
console.log('Cache hits:', batchResult.cacheHits);
```

---

## 下一步

C1 完成后，以下计划可以继续：
- [D] vector-store（需要 C1）
- [F] indexer（需要 C1）

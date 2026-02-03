# [Local Embedding & Rerank] Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 默认本地运行 Qwen3 Embedding 与 Rerank，支持 API 模式与禁用开关，且 embedding 与 LLM 配置分离。

**Architecture:** 在 @agent-fs/llm 新增 RerankService 与 Provider；EmbeddingService 增强“本地模型白名单 + API 优先”；SearchFusion 内部可选 rerank；配置通过 zod 校验强制规则。

**Tech Stack:** TypeScript, transformers.js, Vitest, Zod

---

## Task 1: 扩展配置类型

**Files:**
- Modify: `packages/core/src/types/config.ts`

**Step 1: 写测试（类型层的使用用例）**
新增一个类型测试文件，验证新增字段可用：

```ts
// packages/core/src/types/config.test.ts
import type { EmbeddingConfig, RerankConfig } from './config';

it('EmbeddingConfig 支持分离的 api 参数', () => {
  const config: EmbeddingConfig = {
    default: 'api',
    api: {
      provider: 'openai-compatible',
      base_url: 'https://api.example.com/v1',
      api_key: 'k',
      model: 'embedding-2',
    },
  };
  expect(config.api?.base_url).toBe('https://api.example.com/v1');
});

it('RerankConfig 支持 local/api 与继承开关', () => {
  const config: RerankConfig = {
    enabled: true,
    default: 'local',
    local: { model: 'Qwen3-Reranker-0.6B', device: 'cpu' },
    api_inherit: true,
  };
  expect(config.local?.model).toBe('Qwen3-Reranker-0.6B');
});
```

Run: `pnpm --filter @agent-fs/core test packages/core/src/types/config.test.ts`
Expected: FAIL（类型或字段不存在）

**Step 2: 实现类型扩展**

```ts
// packages/core/src/types/config.ts
export interface RerankConfig {
  enabled: boolean;
  default: 'local' | 'api';
  api_inherit?: boolean;
  local?: LocalRerankConfig;
  api?: APIRerankConfig;
}

export interface LocalRerankConfig {
  model: string;
  device: 'cpu' | 'gpu';
}

export interface APIRerankConfig {
  provider: 'openai-compatible';
  base_url: string;
  api_key: string;
  model: string;
}
```

**Step 3: 运行测试**
Run: `pnpm --filter @agent-fs/core test packages/core/src/types/config.test.ts`
Expected: PASS

**Step 4: Commit**
```bash
git add packages/core/src/types/config.ts packages/core/src/types/config.test.ts
git commit -m "feat(core): extend rerank config types"
```

---

## Task 2: 更新配置校验规则

**Files:**
- Modify: `packages/core/src/config/schema.ts`
- Modify: `packages/core/src/config/schema.test.ts`

**Step 1: 写失败测试**

```ts
// packages/core/src/config/schema.test.ts
it('should reject unsupported local embedding model', () => {
  const config = {
    llm: { provider: 'openai-compatible', base_url: 'https://x', api_key: 'k', model: 'm' },
    embedding: {
      default: 'local',
      local: { model: 'other-model', device: 'cpu' },
    },
    indexing: { chunk_size: { min_tokens: 10, max_tokens: 20 } },
    search: { default_top_k: 3, fusion: { method: 'rrf' } },
  };
  expect(() => validateConfig(config)).toThrow();
});

it('should accept rerank api inherit config', () => {
  const config = {
    llm: { provider: 'openai-compatible', base_url: 'https://x', api_key: 'k', model: 'm' },
    embedding: {
      default: 'api',
      api: { provider: 'openai-compatible', base_url: 'https://e', api_key: 'k', model: 'embedding-2' },
    },
    rerank: { enabled: true, default: 'api', api_inherit: true },
    indexing: { chunk_size: { min_tokens: 10, max_tokens: 20 } },
    search: { default_top_k: 3, fusion: { method: 'rrf' } },
  };
  const result = validateConfig(config);
  expect(result.rerank?.api_inherit).toBe(true);
});
```

Run: `pnpm --filter @agent-fs/core test packages/core/src/config/schema.test.ts`
Expected: FAIL

**Step 2: 实现 schema**

```ts
// packages/core/src/config/schema.ts
const localEmbeddingSchema = z.object({
  model: z.literal('Qwen/Qwen3-Embedding-0.6B-ONNX'),
  device: z.enum(['cpu', 'gpu']).default('cpu'),
});

const localRerankSchema = z.object({
  model: z.literal('Qwen3-Reranker-0.6B'),
  device: z.enum(['cpu', 'gpu']).default('cpu'),
});

const apiRerankSchema = z.object({
  provider: z.literal('openai-compatible'),
  base_url: z.string().url(),
  api_key: z.string().min(1),
  model: z.string().min(1),
});

const rerankConfigSchema = z.object({
  enabled: z.boolean(),
  default: z.enum(['local', 'api']),
  api_inherit: z.boolean().default(true),
  local: localRerankSchema.optional(),
  api: apiRerankSchema.optional(),
});
```

**Step 3: 运行测试**
Run: `pnpm --filter @agent-fs/core test packages/core/src/config/schema.test.ts`
Expected: PASS

**Step 4: Commit**
```bash
git add packages/core/src/config/schema.ts packages/core/src/config/schema.test.ts
git commit -m "feat(core): validate local embedding/rerank models"
```

---

## Task 3: EmbeddingService 行为调整（API 优先）

**Files:**
- Modify: `packages/llm/src/embedding/service.ts`
- Modify: `packages/llm/src/embedding/service.test.ts`

**Step 1: 写失败测试**

```ts
it('should prefer api when api config is provided', async () => {
  const apiConfig: EmbeddingConfig = {
    default: 'local',
    local: { model: 'Qwen/Qwen3-Embedding-0.6B-ONNX', device: 'cpu' },
    api: { provider: 'openai-compatible', base_url: 'https://e', api_key: 'k', model: 'embedding-2' },
  };
  const module = await import('./service');
  const service = new module.EmbeddingService(apiConfig);
  await service.init();
  expect(service.getDimension()).toBe(512);
});
```

Run: `pnpm --filter @agent-fs/llm test packages/llm/src/embedding/service.test.ts`
Expected: FAIL

**Step 2: 实现 API 优先**

```ts
// packages/llm/src/embedding/service.ts
if (config.api) {
  this.modelName = config.api.model;
  this.provider = new APIEmbeddingProvider({
    base_url: config.api.base_url,
    api_key: config.api.api_key,
    model: config.api.model,
  });
} else if (config.default === 'local' && config.local) {
  ...
}
```

**Step 3: 运行测试**
Run: `pnpm --filter @agent-fs/llm test packages/llm/src/embedding/service.test.ts`
Expected: PASS

**Step 4: Commit**
```bash
git add packages/llm/src/embedding/service.ts packages/llm/src/embedding/service.test.ts
git commit -m "feat(llm): prefer api embedding config when provided"
```

---

## Task 4: 新增 Rerank 模块（本地 + API）

**Files:**
- Create: `packages/llm/src/rerank/index.ts`
- Create: `packages/llm/src/rerank/service.ts`
- Create: `packages/llm/src/rerank/local-provider.ts`
- Create: `packages/llm/src/rerank/api-provider.ts`
- Modify: `packages/llm/src/index.ts`

**Step 1: 写失败测试**

```ts
// packages/llm/src/rerank/service.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { RerankConfig } from '@agent-fs/core';

vi.mock('./local-provider', () => ({
  LocalRerankProvider: class {
    init = vi.fn();
    rerank = vi.fn(async () => [0.9, 0.1]);
    dispose = vi.fn();
  },
}));

describe('RerankService', () => {
  it('should rerank with local provider', async () => {
    const config: RerankConfig = {
      enabled: true,
      default: 'local',
      local: { model: 'Qwen3-Reranker-0.6B', device: 'cpu' },
    };
    const module = await import('./service');
    const service = new module.RerankService(config);
    await service.init();
    const scores = await service.rerank('q', ['a', 'b']);
    expect(scores[0]).toBeGreaterThan(scores[1]);
  });
});
```

Run: `pnpm --filter @agent-fs/llm test packages/llm/src/rerank/service.test.ts`
Expected: FAIL

**Step 2: 实现 RerankService 与 Provider**

```ts
// packages/llm/src/rerank/service.ts
import type { RerankConfig, EmbeddingConfig } from '@agent-fs/core';
import { LocalRerankProvider } from './local-provider';
import { APIRerankProvider } from './api-provider';

export interface RerankProvider {
  init(): Promise<void>;
  rerank(query: string, documents: string[]): Promise<number[]>;
  dispose(): Promise<void>;
}

export class RerankService {
  private provider: RerankProvider;
  private initPromise: Promise<void> | null = null;

  constructor(config: RerankConfig, embeddingApiFallback?: EmbeddingConfig['api']) {
    if (config.default === 'api' || config.api) {
      const api = config.api ?? embeddingApiFallback;
      if (!api) throw new Error('Rerank API config missing');
      this.provider = new APIRerankProvider({
        base_url: api.base_url,
        api_key: api.api_key,
        model: api.model,
      });
    } else {
      if (!config.local) throw new Error('Rerank local config missing');
      this.provider = new LocalRerankProvider({
        model: config.local.model,
        device: config.local.device,
      });
    }
  }

  async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.provider.init();
    }
    await this.initPromise;
  }

  async rerank(query: string, documents: string[]): Promise<number[]> {
    await this.init();
    return this.provider.rerank(query, documents);
  }

  async dispose(): Promise<void> {
    await this.provider.dispose();
  }
}
```

```ts
// packages/llm/src/rerank/local-provider.ts
import { pipeline, type TextClassificationPipeline } from '@xenova/transformers';

export interface LocalRerankOptions {
  model: string;
  device?: 'cpu' | 'gpu';
  onProgress?: (event: { phase: 'download' | 'load' | 'ready'; percent?: number }) => void;
}

export class LocalRerankProvider {
  private options: LocalRerankOptions;
  private pipeline: TextClassificationPipeline | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(options: LocalRerankOptions) {
    this.options = { device: 'cpu', ...options };
  }

  async init(): Promise<void> {
    if (this.pipeline) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.loadModel();
    await this.initPromise;
  }

  private async loadModel(): Promise<void> {
    this.options.onProgress?.({ phase: 'download' });
    this.pipeline = await pipeline('text-classification', this.options.model, {
      // transformers.js 内部会处理下载与缓存
    });
    this.options.onProgress?.({ phase: 'ready', percent: 100 });
  }

  async rerank(query: string, documents: string[]): Promise<number[]> {
    await this.init();
    if (!this.pipeline) throw new Error('Pipeline not initialized');

    const scores: number[] = [];
    for (const doc of documents) {
      const input = { text: query, text_pair: doc } as const;
      const result = await this.pipeline(input);
      scores.push(result[0]?.score ?? 0);
    }
    return scores;
  }

  async dispose(): Promise<void> {
    this.pipeline = null;
    this.initPromise = null;
  }
}
```

```ts
// packages/llm/src/rerank/api-provider.ts
export interface APIRerankOptions {
  base_url: string;
  api_key: string;
  model: string;
  timeout?: number;
  maxRetries?: number;
}

export class APIRerankProvider {
  private options: Required<APIRerankOptions>;

  constructor(options: APIRerankOptions) {
    this.options = { timeout: 30000, maxRetries: 3, ...options };
  }

  async init(): Promise<void> {}

  async rerank(query: string, documents: string[]): Promise<number[]> {
    const url = `${this.options.base_url}/rerank`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.options.api_key}`,
          },
          body: JSON.stringify({ model: this.options.model, query, documents }),
          signal: AbortSignal.timeout(this.options.timeout),
        });
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const data = await response.json();
        return data.results.map((r: { score: number }) => r.score);
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.options.maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
        }
      }
    }

    throw lastError ?? new Error('Failed to rerank');
  }

  async dispose(): Promise<void> {}
}
```

**Step 3: 运行测试**
Run: `pnpm --filter @agent-fs/llm test packages/llm/src/rerank/service.test.ts`
Expected: PASS

**Step 4: Commit**
```bash
git add packages/llm/src/rerank packages/llm/src/index.ts packages/llm/src/rerank/service.test.ts
git commit -m "feat(llm): add rerank service and providers"
```

---

## Task 5: SearchFusion 集成 Rerank

**Files:**
- Modify: `packages/search/src/fusion/search-fusion.ts`
- Modify: `packages/search/src/fusion/search-fusion.test.ts`

**Step 1: 写失败测试**

```ts
it('should rerank results when enabled', async () => {
  const fusion = createSearchFusion(vectorStore, bm25Index, embeddingService, rerankService);
  const response = await fusion.search({ query: 'q', topK: 3 }, { useRerank: true });
  expect(response.meta.rerankApplied).toBe(true);
});
```

Run: `pnpm --filter @agent-fs/search test packages/search/src/fusion/search-fusion.test.ts`
Expected: FAIL

**Step 2: 实现 rerank 流程**

```ts
// packages/search/src/fusion/search-fusion.ts
export interface FusionOptions {
  ...
  useRerank?: boolean;
  rerankMultiplier?: number;
}

// SearchFusion.search 末尾：
const useRerank = fusionOptions.useRerank ?? true;
if (this.rerankService && useRerank && fused.length > 0) {
  const limit = Math.min(fused.length, topK * (fusionOptions.rerankMultiplier ?? 2));
  const candidates = fused.slice(0, limit).map((f) => f.item);
  const scores = await this.rerankService.rerank(query, candidates.map((c) => c.content));
  candidates.forEach((c, i) => (c.score = scores[i] ?? c.score));
  candidates.sort((a, b) => b.score - a.score);
  return { results: candidates.slice(0, topK), meta: { ...meta, rerankApplied: true } };
}
```

**Step 3: 运行测试**
Run: `pnpm --filter @agent-fs/search test packages/search/src/fusion/search-fusion.test.ts`
Expected: PASS

**Step 4: Commit**
```bash
git add packages/search/src/fusion/search-fusion.ts packages/search/src/fusion/search-fusion.test.ts
git commit -m "feat(search): add optional rerank in SearchFusion"
```

---

## Task 6: 文档与示例配置

**Files:**
- Modify: `docs/requirements.md`（若存在相关配置说明）
- Modify: `docs/guides/code-standards.md`（如需补充模型依赖说明）

**Step 1: 更新文档**
补充 embedding/rerank 配置示例与默认行为说明。

**Step 2: 提交**
```bash
git add docs/requirements.md docs/guides/code-standards.md
git commit -m "docs: add local embedding/rerank config examples"
```

---

## 完成检查清单

- [ ] 本地 embedding 仅允许 Qwen3-Embedding-0.6B-ONNX
- [ ] embedding API 配置与 LLM 配置分离
- [ ] rerank 默认本地且可禁用
- [ ] rerank 可复用 embedding API 配置
- [ ] SearchFusion rerank 集成与开关生效
- [ ] 测试覆盖配置、服务与融合链路


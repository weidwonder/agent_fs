# [B1] Config - 配置管理实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现配置加载、验证和管理功能

**Architecture:** 支持 YAML 配置文件 + 环境变量 + .env 文件，使用 zod 进行验证

**Tech Stack:** js-yaml, zod, dotenv

**依赖:** [A] foundation

**被依赖:** [C1] embedding, [C2] summary

---

## 成功标准

- [ ] 能读取 `~/.agent_fs/config.yaml`
- [ ] 支持 `${ENV_VAR}` 变量替换
- [ ] 支持 `.env` 文件加载
- [ ] 配置验证通过/失败有明确错误信息
- [ ] 单元测试覆盖率 > 80%

---

## Task 1: 创建 config 模块目录结构

**Files:**
- Create: `packages/core/src/config/index.ts`
- Create: `packages/core/src/config/loader.ts`
- Create: `packages/core/src/config/schema.ts`
- Create: `packages/core/src/config/env.ts`

**Step 1: 创建目录**

Run: `mkdir -p packages/core/src/config`
Expected: 目录创建成功

**Step 2: 安装依赖**

Run: `pnpm add -D -w zod js-yaml dotenv && pnpm add -D -w @types/js-yaml`
Expected: 成功安装

**Step 3: 创建 index.ts（占位）**

```typescript
// Config module entry point
export { loadConfig } from './loader';
export { configSchema, type ResolvedConfig } from './schema';
```

**Step 4: Commit**

```bash
git add packages/core/src/config
git commit -m "chore(core): create config module structure"
```

---

## Task 2: 实现配置 Schema

**Files:**
- Modify: `packages/core/src/config/schema.ts`

**Step 1: 创建 schema.ts**

```typescript
import { z } from 'zod';

/**
 * LLM 配置 schema
 */
const llmConfigSchema = z.object({
  provider: z.literal('openai-compatible'),
  base_url: z.string().url(),
  api_key: z.string().min(1),
  model: z.string().min(1),
});

/**
 * 本地 Embedding 配置 schema
 */
const localEmbeddingSchema = z.object({
  model: z.string().min(1),
  device: z.enum(['cpu', 'gpu']).default('cpu'),
});

/**
 * API Embedding 配置 schema
 */
const apiEmbeddingSchema = z.object({
  provider: z.literal('openai-compatible'),
  base_url: z.string().url(),
  api_key: z.string().min(1),
  model: z.string().min(1),
});

/**
 * Embedding 配置 schema
 */
const embeddingConfigSchema = z.object({
  default: z.enum(['local', 'api']),
  local: localEmbeddingSchema.optional(),
  api: apiEmbeddingSchema.optional(),
});

/**
 * Rerank 配置 schema
 */
const rerankConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.literal('llm'),
});

/**
 * 索引配置 schema
 */
const indexingConfigSchema = z.object({
  chunk_size: z.object({
    min_tokens: z.number().int().positive().default(600),
    max_tokens: z.number().int().positive().default(1200),
  }),
});

/**
 * 搜索配置 schema
 */
const searchConfigSchema = z.object({
  default_top_k: z.number().int().positive().default(10),
  fusion: z.object({
    method: z.literal('rrf'),
  }),
});

/**
 * 完整配置 schema
 */
export const configSchema = z.object({
  llm: llmConfigSchema,
  embedding: embeddingConfigSchema,
  rerank: rerankConfigSchema.optional(),
  indexing: indexingConfigSchema,
  search: searchConfigSchema,
  plugins: z.record(z.unknown()).optional(),
});

/**
 * 解析后的配置类型
 */
export type ResolvedConfig = z.infer<typeof configSchema>;

/**
 * 验证配置
 */
export function validateConfig(config: unknown): ResolvedConfig {
  return configSchema.parse(config);
}
```

**Step 2: 验证编译**

Run: `pnpm --filter @agent-fs/core build`
Expected: 编译成功

**Step 3: Commit**

```bash
git add packages/core/src/config/schema.ts
git commit -m "feat(core): add config schema with zod validation"
```

---

## Task 3: 实现环境变量处理

**Files:**
- Modify: `packages/core/src/config/env.ts`

**Step 1: 创建 env.ts**

```typescript
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * 加载 .env 文件
 * 优先级：当前目录 > ~/.agent_fs/.env
 */
export function loadEnvFiles(): void {
  // 加载 ~/.agent_fs/.env
  const globalEnvPath = join(homedir(), '.agent_fs', '.env');
  if (existsSync(globalEnvPath)) {
    loadDotenv({ path: globalEnvPath });
  }

  // 加载当前目录 .env（会覆盖全局配置）
  loadDotenv();
}

/**
 * 替换配置中的环境变量占位符
 * 支持 ${VAR_NAME} 格式
 */
export function resolveEnvVariables(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return resolveEnvString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(resolveEnvVariables);
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVariables(value);
    }
    return result;
  }

  return obj;
}

/**
 * 替换字符串中的环境变量
 */
function resolveEnvString(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    const value = process.env[varName];
    if (value === undefined) {
      throw new Error(`Environment variable not found: ${varName}`);
    }
    return value;
  });
}
```

**Step 2: 验证编译**

Run: `pnpm --filter @agent-fs/core build`
Expected: 编译成功

**Step 3: Commit**

```bash
git add packages/core/src/config/env.ts
git commit -m "feat(core): add environment variable resolver"
```

---

## Task 4: 实现配置加载器

**Files:**
- Modify: `packages/core/src/config/loader.ts`

**Step 1: 创建 loader.ts**

```typescript
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { load as parseYaml } from 'js-yaml';
import { loadEnvFiles, resolveEnvVariables } from './env';
import { validateConfig, type ResolvedConfig } from './schema';

/**
 * 配置加载选项
 */
export interface LoadConfigOptions {
  /** 配置文件路径（可选，默认 ~/.agent_fs/config.yaml） */
  configPath?: string;

  /** 是否加载 .env 文件 */
  loadEnv?: boolean;
}

/**
 * 获取默认配置文件路径
 */
export function getDefaultConfigPath(): string {
  return join(homedir(), '.agent_fs', 'config.yaml');
}

/**
 * 加载配置文件
 */
export function loadConfig(options: LoadConfigOptions = {}): ResolvedConfig {
  const { configPath = getDefaultConfigPath(), loadEnv = true } = options;

  // 加载 .env 文件
  if (loadEnv) {
    loadEnvFiles();
  }

  // 检查配置文件是否存在
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  // 读取并解析 YAML
  const fileContent = readFileSync(configPath, 'utf-8');
  const rawConfig = parseYaml(fileContent);

  // 替换环境变量
  const resolvedConfig = resolveEnvVariables(rawConfig);

  // 验证配置
  return validateConfig(resolvedConfig);
}

/**
 * 检查配置文件是否存在
 */
export function configExists(configPath?: string): boolean {
  const path = configPath ?? getDefaultConfigPath();
  return existsSync(path);
}
```

**Step 2: 更新 index.ts**

```typescript
// Config module entry point
export { loadConfig, configExists, getDefaultConfigPath, type LoadConfigOptions } from './loader';
export { configSchema, validateConfig, type ResolvedConfig } from './schema';
export { loadEnvFiles, resolveEnvVariables } from './env';
```

**Step 3: 验证编译**

Run: `pnpm --filter @agent-fs/core build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add packages/core/src/config
git commit -m "feat(core): add config loader with YAML and env support"
```

---

## Task 5: 更新 core 包导出

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/package.json`

**Step 1: 更新 index.ts**

在 index.ts 末尾添加：

```typescript
// Config
export {
  loadConfig,
  configExists,
  getDefaultConfigPath,
  configSchema,
  validateConfig,
  loadEnvFiles,
  resolveEnvVariables,
  type LoadConfigOptions,
  type ResolvedConfig,
} from './config';
```

**Step 2: 更新 package.json 依赖**

```json
{
  "dependencies": {
    "dotenv": "^16.3.0",
    "js-yaml": "^4.1.0",
    "zod": "^3.22.0"
  }
}
```

Run: `pnpm install`

**Step 3: 验证编译**

Run: `pnpm --filter @agent-fs/core build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add packages/core
git commit -m "feat(core): export config module from core package"
```

---

## Task 6: 编写单元测试 - 环境变量

**Files:**
- Create: `packages/core/src/config/env.test.ts`

**Step 1: 创建 env.test.ts**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveEnvVariables } from './env';

describe('resolveEnvVariables', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should replace single env variable in string', () => {
    process.env.TEST_VAR = 'test_value';
    const result = resolveEnvVariables('${TEST_VAR}');
    expect(result).toBe('test_value');
  });

  it('should replace multiple env variables in string', () => {
    process.env.VAR1 = 'hello';
    process.env.VAR2 = 'world';
    const result = resolveEnvVariables('${VAR1} ${VAR2}');
    expect(result).toBe('hello world');
  });

  it('should throw error for missing env variable', () => {
    expect(() => resolveEnvVariables('${MISSING_VAR}')).toThrow(
      'Environment variable not found: MISSING_VAR'
    );
  });

  it('should recursively resolve nested objects', () => {
    process.env.API_KEY = 'secret123';
    const config = {
      llm: {
        api_key: '${API_KEY}',
        model: 'gpt-4',
      },
    };
    const result = resolveEnvVariables(config);
    expect(result).toEqual({
      llm: {
        api_key: 'secret123',
        model: 'gpt-4',
      },
    });
  });

  it('should handle arrays', () => {
    process.env.ITEM = 'value';
    const arr = ['${ITEM}', 'static'];
    const result = resolveEnvVariables(arr);
    expect(result).toEqual(['value', 'static']);
  });

  it('should pass through non-string primitives', () => {
    expect(resolveEnvVariables(123)).toBe(123);
    expect(resolveEnvVariables(true)).toBe(true);
    expect(resolveEnvVariables(null)).toBe(null);
  });
});
```

**Step 2: 运行测试**

Run: `pnpm test`
Expected: 测试通过

**Step 3: Commit**

```bash
git add packages/core/src/config/env.test.ts
git commit -m "test(core): add env variable resolver tests"
```

---

## Task 7: 编写单元测试 - Schema 验证

**Files:**
- Create: `packages/core/src/config/schema.test.ts`

**Step 1: 创建 schema.test.ts**

```typescript
import { describe, it, expect } from 'vitest';
import { validateConfig, configSchema } from './schema';
import { ZodError } from 'zod';

describe('configSchema', () => {
  const validConfig = {
    llm: {
      provider: 'openai-compatible',
      base_url: 'https://api.openai.com/v1',
      api_key: 'sk-test',
      model: 'gpt-4o-mini',
    },
    embedding: {
      default: 'local',
      local: {
        model: 'bge-small-zh-v1.5',
        device: 'cpu',
      },
    },
    indexing: {
      chunk_size: {
        min_tokens: 600,
        max_tokens: 1200,
      },
    },
    search: {
      default_top_k: 10,
      fusion: {
        method: 'rrf',
      },
    },
  };

  it('should validate a correct config', () => {
    const result = validateConfig(validConfig);
    expect(result.llm.provider).toBe('openai-compatible');
    expect(result.embedding.default).toBe('local');
  });

  it('should reject missing required fields', () => {
    const invalidConfig = { ...validConfig, llm: undefined };
    expect(() => validateConfig(invalidConfig)).toThrow(ZodError);
  });

  it('should reject invalid URL', () => {
    const invalidConfig = {
      ...validConfig,
      llm: { ...validConfig.llm, base_url: 'not-a-url' },
    };
    expect(() => validateConfig(invalidConfig)).toThrow(ZodError);
  });

  it('should reject invalid provider', () => {
    const invalidConfig = {
      ...validConfig,
      llm: { ...validConfig.llm, provider: 'invalid' },
    };
    expect(() => validateConfig(invalidConfig)).toThrow(ZodError);
  });

  it('should apply default values', () => {
    const minConfig = {
      llm: validConfig.llm,
      embedding: { default: 'local' },
      indexing: { chunk_size: {} },
      search: { fusion: { method: 'rrf' } },
    };
    const result = validateConfig(minConfig);
    expect(result.indexing.chunk_size.min_tokens).toBe(600);
    expect(result.indexing.chunk_size.max_tokens).toBe(1200);
    expect(result.search.default_top_k).toBe(10);
  });

  it('should allow optional rerank config', () => {
    const configWithRerank = {
      ...validConfig,
      rerank: {
        enabled: true,
        provider: 'llm',
      },
    };
    const result = validateConfig(configWithRerank);
    expect(result.rerank?.enabled).toBe(true);
  });

  it('should allow optional plugins config', () => {
    const configWithPlugins = {
      ...validConfig,
      plugins: {
        pdf: { extra_param: 'value' },
      },
    };
    const result = validateConfig(configWithPlugins);
    expect(result.plugins?.pdf).toEqual({ extra_param: 'value' });
  });
});
```

**Step 2: 运行测试**

Run: `pnpm test`
Expected: 测试通过

**Step 3: Commit**

```bash
git add packages/core/src/config/schema.test.ts
git commit -m "test(core): add config schema validation tests"
```

---

## Task 8: 编写集成测试 - 配置加载

**Files:**
- Create: `packages/core/src/config/loader.test.ts`

**Step 1: 创建 loader.test.ts**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, configExists } from './loader';

describe('loadConfig', () => {
  const testDir = join(tmpdir(), 'agent-fs-test-' + Date.now());
  const configPath = join(testDir, 'config.yaml');
  const envPath = join(testDir, '.env');

  const validYaml = `
llm:
  provider: openai-compatible
  base_url: https://api.openai.com/v1
  api_key: \${TEST_API_KEY}
  model: gpt-4o-mini

embedding:
  default: local
  local:
    model: bge-small-zh-v1.5
    device: cpu

indexing:
  chunk_size:
    min_tokens: 600
    max_tokens: 1200

search:
  default_top_k: 10
  fusion:
    method: rrf
`;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env.TEST_API_KEY = 'sk-test-key';
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.TEST_API_KEY;
  });

  it('should load config from file', () => {
    writeFileSync(configPath, validYaml);
    const config = loadConfig({ configPath, loadEnv: false });
    expect(config.llm.api_key).toBe('sk-test-key');
    expect(config.embedding.default).toBe('local');
  });

  it('should throw error for missing file', () => {
    expect(() => loadConfig({ configPath: '/nonexistent/path.yaml' })).toThrow(
      'Config file not found'
    );
  });

  it('should resolve env variables from .env file', () => {
    writeFileSync(configPath, validYaml);
    writeFileSync(envPath, 'TEST_API_KEY=from-dotenv');

    // 清除已有的环境变量，让 .env 生效
    delete process.env.TEST_API_KEY;

    // 注意：dotenv 不会覆盖已存在的环境变量
    // 这里我们需要手动设置
    process.env.TEST_API_KEY = 'from-dotenv';

    const config = loadConfig({ configPath, loadEnv: true });
    expect(config.llm.api_key).toBe('from-dotenv');
  });

  it('should throw error for invalid config', () => {
    const invalidYaml = `
llm:
  provider: invalid-provider
`;
    writeFileSync(configPath, invalidYaml);
    expect(() => loadConfig({ configPath, loadEnv: false })).toThrow();
  });
});

describe('configExists', () => {
  const testDir = join(tmpdir(), 'agent-fs-test-exists-' + Date.now());
  const configPath = join(testDir, 'config.yaml');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should return true for existing file', () => {
    writeFileSync(configPath, 'test: true');
    expect(configExists(configPath)).toBe(true);
  });

  it('should return false for missing file', () => {
    expect(configExists('/nonexistent/path.yaml')).toBe(false);
  });
});
```

**Step 2: 运行测试**

Run: `pnpm test`
Expected: 测试通过

**Step 3: Commit**

```bash
git add packages/core/src/config/loader.test.ts
git commit -m "test(core): add config loader integration tests"
```

---

## Task 9: 运行测试覆盖率

**Step 1: 运行覆盖率测试**

Run: `pnpm test:coverage`
Expected: config 模块覆盖率 > 80%

**Step 2: 检查覆盖率报告**

查看 `coverage/` 目录下的报告，确保主要代码路径都被测试覆盖。

**Step 3: Commit（如需修复）**

如果覆盖率不足，添加更多测试用例。

---

## Task 10: 最终验证

**Step 1: 完整构建**

Run: `pnpm build`
Expected: 编译成功

**Step 2: 运行所有测试**

Run: `pnpm test`
Expected: 所有测试通过

**Step 3: Lint 检查**

Run: `pnpm lint`
Expected: 无错误

---

## 完成检查清单

- [ ] `loadConfig()` 能正确加载 YAML 配置
- [ ] 环境变量 `${VAR}` 能正确替换
- [ ] `.env` 文件能被加载
- [ ] 配置验证失败时有明确错误信息
- [ ] 测试覆盖率 > 80%
- [ ] 所有代码已提交

---

## 输出接口

```typescript
// 从 @agent-fs/core 导入
import {
  loadConfig,
  configExists,
  getDefaultConfigPath,
  validateConfig,
  type ResolvedConfig,
  type LoadConfigOptions,
} from '@agent-fs/core';

// 使用示例
const config = loadConfig();
console.log(config.llm.model); // 'gpt-4o-mini'
```

---

## 下一步

B1 完成后，以下计划可以继续：
- [C1] embedding（依赖 B1）
- [C2] summary（依赖 B1）

# [A] Foundation - 基础设施实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 搭建 Monorepo 基础设施，定义所有核心类型接口

**Architecture:** pnpm workspace + TypeScript，packages/ 目录下按功能模块划分

**Tech Stack:** pnpm, TypeScript 5.x, ESLint, Prettier, Vitest

**依赖:** 无

**被依赖:** 所有其他计划

---

## 成功标准

- [ ] `pnpm install` 成功执行
- [ ] `pnpm build` 成功编译所有包
- [ ] `pnpm test` 能运行测试（即使暂无测试用例）
- [ ] `pnpm lint` 能检查代码风格
- [ ] `@agent-fs/core` 包导出所有类型定义
- [ ] 类型定义覆盖：DocumentPlugin, Chunk, SearchResult, Config, IndexMetadata

---

## Task 1: 初始化 pnpm workspace

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.npmrc`

**Step 1: 创建根 package.json**

```json
{
  "name": "agent-fs",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "clean": "pnpm -r clean"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  },
  "engines": {
    "node": ">=18.0.0",
    "pnpm": ">=8.0.0"
  }
}
```

**Step 2: 创建 pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'
  - 'packages/plugins/*'
```

**Step 3: 创建 .npmrc**

```ini
shamefully-hoist=true
strict-peer-dependencies=false
```

**Step 4: 运行 pnpm install**

Run: `pnpm install`
Expected: 成功安装依赖

**Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml .npmrc pnpm-lock.yaml
git commit -m "chore: initialize pnpm workspace"
```

---

## Task 2: 配置 TypeScript

**Files:**
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`

**Step 1: 创建 tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "incremental": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

**Step 2: 创建 tsconfig.json（项目引用）**

```json
{
  "files": [],
  "references": [
    { "path": "packages/core" }
  ]
}
```

**Step 3: Commit**

```bash
git add tsconfig.base.json tsconfig.json
git commit -m "chore: add TypeScript configuration"
```

---

## Task 3: 配置 ESLint + Prettier

**Files:**
- Create: `eslint.config.js`
- Create: `.prettierrc`
- Create: `.prettierignore`
- Modify: `package.json`

**Step 1: 安装依赖**

Run: `pnpm add -D -w eslint @eslint/js typescript-eslint prettier eslint-config-prettier`
Expected: 成功安装

**Step 2: 创建 eslint.config.js**

```javascript
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.js', '!eslint.config.js'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  }
);
```

**Step 3: 创建 .prettierrc**

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

**Step 4: 创建 .prettierignore**

```
dist
node_modules
pnpm-lock.yaml
*.md
```

**Step 5: Commit**

```bash
git add eslint.config.js .prettierrc .prettierignore package.json pnpm-lock.yaml
git commit -m "chore: add ESLint and Prettier configuration"
```

---

## Task 4: 配置 Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

**Step 1: 安装依赖**

Run: `pnpm add -D -w vitest`
Expected: 成功安装

**Step 2: 创建 vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/src/**/*.test.ts', 'packages/**/src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/**/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/types/**'],
    },
  },
});
```

**Step 3: 更新 package.json scripts**

在 package.json 中添加：
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

**Step 4: Commit**

```bash
git add vitest.config.ts package.json pnpm-lock.yaml
git commit -m "chore: add Vitest configuration"
```

---

## Task 5: 创建 core 包目录结构

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`

**Step 1: 创建目录**

Run: `mkdir -p packages/core/src/types`
Expected: 目录创建成功

**Step 2: 创建 packages/core/package.json**

```json
{
  "name": "@agent-fs/core",
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
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

**Step 3: 创建 packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 4: 创建 packages/core/src/index.ts（占位）**

```typescript
// @agent-fs/core
// 核心类型定义导出

export const VERSION = '0.1.0';
```

**Step 5: 运行 pnpm install 并验证**

Run: `pnpm install && pnpm --filter @agent-fs/core build`
Expected: 编译成功

**Step 6: Commit**

```bash
git add packages/core
git commit -m "chore: create @agent-fs/core package structure"
```

---

## Task 6: 定义 Plugin 类型

**Files:**
- Create: `packages/core/src/types/plugin.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: 创建 plugin.ts**

```typescript
/**
 * 文档处理插件接口
 */
export interface DocumentPlugin {
  /** 插件名称 */
  name: string;

  /** 支持的文件扩展名（不含点，如 'pdf', 'docx'） */
  supportedExtensions: string[];

  /**
   * 将文档转换为 Markdown
   * @param filePath 文件绝对路径
   * @returns Markdown 内容和位置映射
   */
  toMarkdown(filePath: string): Promise<DocumentConversionResult>;

  /**
   * 解析 locator 为可读文本
   * @param locator 原始定位符
   * @returns 可读的位置描述
   */
  parseLocator?(locator: string): LocatorInfo;

  /** 插件初始化 */
  init?(): Promise<void>;

  /** 插件销毁 */
  dispose?(): Promise<void>;
}

/**
 * 文档转换结果
 */
export interface DocumentConversionResult {
  /** 转换后的 Markdown 内容 */
  markdown: string;

  /** 位置映射表 */
  mapping: PositionMapping[];
}

/**
 * 位置映射
 * 将 Markdown 中的行范围映射到原文档位置
 */
export interface PositionMapping {
  /** Markdown 中的行范围 */
  markdownRange: {
    startLine: number;
    endLine: number;
  };

  /** 原文档定位符（插件自定义格式） */
  originalLocator: string;
}

/**
 * 定位符信息
 */
export interface LocatorInfo {
  /** 可读的位置描述 */
  displayText: string;

  /** 跳转信息（可选，供 UI 使用） */
  jumpInfo?: unknown;
}
```

**Step 2: 更新 index.ts**

```typescript
// @agent-fs/core
// 核心类型定义导出

export const VERSION = '0.1.0';

// Plugin types
export type {
  DocumentPlugin,
  DocumentConversionResult,
  PositionMapping,
  LocatorInfo,
} from './types/plugin';
```

**Step 3: 验证编译**

Run: `pnpm --filter @agent-fs/core build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): add DocumentPlugin type definitions"
```

---

## Task 7: 定义 Chunk 类型

**Files:**
- Create: `packages/core/src/types/chunk.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: 创建 chunk.ts**

```typescript
/**
 * 文本切片
 */
export interface Chunk {
  /** 切片唯一标识：file_id:chunk_index */
  id: string;

  /** 切片内容 */
  content: string;

  /** 切片摘要 */
  summary: string;

  /** Token 数量 */
  tokenCount: number;

  /** 原文定位符 */
  locator: string;

  /** 所属文件 ID */
  fileId: string;

  /** 切片索引（从 0 开始） */
  index: number;
}

/**
 * 切片元数据（用于切分阶段，尚未生成 summary）
 */
export interface ChunkMetadata {
  /** 切片内容 */
  content: string;

  /** Token 数量 */
  tokenCount: number;

  /** 原文定位符 */
  locator: string;

  /** Markdown 行范围 */
  markdownRange: {
    startLine: number;
    endLine: number;
  };
}

/**
 * 切分结果
 */
export interface ChunkResult {
  /** 切片列表 */
  chunks: ChunkMetadata[];

  /** 总 token 数 */
  totalTokens: number;
}

/**
 * 切分器选项
 */
export interface ChunkerOptions {
  /** 最小 token 数 */
  minTokens: number;

  /** 最大 token 数 */
  maxTokens: number;

  /** 重叠比例（0-1，如 0.1 表示 10%） */
  overlapRatio?: number;
}
```

**Step 2: 更新 index.ts**

```typescript
// @agent-fs/core
// 核心类型定义导出

export const VERSION = '0.1.0';

// Plugin types
export type {
  DocumentPlugin,
  DocumentConversionResult,
  PositionMapping,
  LocatorInfo,
} from './types/plugin';

// Chunk types
export type { Chunk, ChunkMetadata, ChunkResult, ChunkerOptions } from './types/chunk';
```

**Step 3: 验证编译**

Run: `pnpm --filter @agent-fs/core build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): add Chunk type definitions"
```

---

## Task 8: 定义 Config 类型

**Files:**
- Create: `packages/core/src/types/config.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: 创建 config.ts**

```typescript
/**
 * 完整配置
 */
export interface Config {
  /** LLM 配置 */
  llm: LLMConfig;

  /** Embedding 配置 */
  embedding: EmbeddingConfig;

  /** Rerank 配置 */
  rerank?: RerankConfig;

  /** 索引配置 */
  indexing: IndexingConfig;

  /** 搜索配置 */
  search: SearchConfig;

  /** 插件配置 */
  plugins?: Record<string, unknown>;
}

/**
 * LLM 配置
 */
export interface LLMConfig {
  /** 提供商类型 */
  provider: 'openai-compatible';

  /** API 地址 */
  baseUrl: string;

  /** API 密钥 */
  apiKey: string;

  /** 模型名称 */
  model: string;
}

/**
 * Embedding 配置
 */
export interface EmbeddingConfig {
  /** 默认模式：local 或 api */
  default: 'local' | 'api';

  /** 本地模型配置 */
  local?: LocalEmbeddingConfig;

  /** API 模型配置 */
  api?: APIEmbeddingConfig;
}

/**
 * 本地 Embedding 配置
 */
export interface LocalEmbeddingConfig {
  /** 模型名称 */
  model: string;

  /** 设备：cpu 或 gpu */
  device: 'cpu' | 'gpu';
}

/**
 * API Embedding 配置
 */
export interface APIEmbeddingConfig {
  /** 提供商类型 */
  provider: 'openai-compatible';

  /** API 地址 */
  baseUrl: string;

  /** API 密钥 */
  apiKey: string;

  /** 模型名称 */
  model: string;
}

/**
 * Rerank 配置
 */
export interface RerankConfig {
  /** 是否启用 */
  enabled: boolean;

  /** 提供商类型 */
  provider: 'llm';
}

/**
 * 索引配置
 */
export interface IndexingConfig {
  /** Chunk 大小配置 */
  chunkSize: {
    minTokens: number;
    maxTokens: number;
  };
}

/**
 * 搜索配置
 */
export interface SearchConfig {
  /** 默认返回数量 */
  defaultTopK: number;

  /** 融合配置 */
  fusion: {
    method: 'rrf';
  };
}
```

**Step 2: 更新 index.ts**

```typescript
// @agent-fs/core
// 核心类型定义导出

export const VERSION = '0.1.0';

// Plugin types
export type {
  DocumentPlugin,
  DocumentConversionResult,
  PositionMapping,
  LocatorInfo,
} from './types/plugin';

// Chunk types
export type { Chunk, ChunkMetadata, ChunkResult, ChunkerOptions } from './types/chunk';

// Config types
export type {
  Config,
  LLMConfig,
  EmbeddingConfig,
  LocalEmbeddingConfig,
  APIEmbeddingConfig,
  RerankConfig,
  IndexingConfig,
  SearchConfig,
} from './types/config';
```

**Step 3: 验证编译**

Run: `pnpm --filter @agent-fs/core build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): add Config type definitions"
```

---

## Task 9: 定义 Search 类型

**Files:**
- Create: `packages/core/src/types/search.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: 创建 search.ts**

```typescript
/**
 * 搜索结果
 */
export interface SearchResult {
  /** Chunk ID */
  chunkId: string;

  /** 相关度分数 */
  score: number;

  /** Chunk 内容 */
  content: string;

  /** Chunk 摘要 */
  summary: string;

  /** 来源信息 */
  source: {
    /** 文件路径 */
    filePath: string;

    /** 原文定位符 */
    locator: string;
  };
}

/**
 * 搜索选项
 */
export interface SearchOptions {
  /** 语义查询 */
  query: string;

  /** 精准关键词查询（可选） */
  keyword?: string;

  /** 搜索范围：目录路径或路径数组 */
  scope: string | string[];

  /** 返回数量 */
  topK?: number;

  /** 过滤条件 */
  filters?: SearchFilters;
}

/**
 * 搜索过滤条件
 */
export interface SearchFilters {
  /** 文件类型过滤 */
  fileTypes?: string[];

  /** 文件名过滤 */
  fileNames?: string[];
}

/**
 * 搜索元信息
 */
export interface SearchMeta {
  /** 搜索的总 chunk 数 */
  totalSearched: number;

  /** 融合方法 */
  fusionMethod: string;

  /** 耗时（毫秒） */
  elapsedMs: number;
}

/**
 * 完整搜索响应
 */
export interface SearchResponse {
  /** 搜索结果列表 */
  results: SearchResult[];

  /** 元信息 */
  meta: SearchMeta;
}
```

**Step 2: 更新 index.ts**

```typescript
// @agent-fs/core
// 核心类型定义导出

export const VERSION = '0.1.0';

// Plugin types
export type {
  DocumentPlugin,
  DocumentConversionResult,
  PositionMapping,
  LocatorInfo,
} from './types/plugin';

// Chunk types
export type { Chunk, ChunkMetadata, ChunkResult, ChunkerOptions } from './types/chunk';

// Config types
export type {
  Config,
  LLMConfig,
  EmbeddingConfig,
  LocalEmbeddingConfig,
  APIEmbeddingConfig,
  RerankConfig,
  IndexingConfig,
  SearchConfig,
} from './types/config';

// Search types
export type {
  SearchResult,
  SearchOptions,
  SearchFilters,
  SearchMeta,
  SearchResponse,
} from './types/search';
```

**Step 3: 验证编译**

Run: `pnpm --filter @agent-fs/core build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): add Search type definitions"
```

---

## Task 10: 定义 Index 类型

**Files:**
- Create: `packages/core/src/types/index-meta.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: 创建 index-meta.ts**

```typescript
/**
 * 目录索引元数据（.fs_index/index.json）
 */
export interface IndexMetadata {
  /** 版本号 */
  version: string;

  /** 创建时间 */
  createdAt: string;

  /** 更新时间 */
  updatedAt: string;

  /** 目录 ID（UUID） */
  dirId: string;

  /** 目录路径 */
  directoryPath: string;

  /** 目录摘要 */
  directorySummary: string;

  /** 统计信息 */
  stats: IndexStats;

  /** 文件列表 */
  files: FileMetadata[];

  /** 子目录列表 */
  subdirectories: SubdirectoryInfo[];

  /** 不支持的文件列表 */
  unsupportedFiles: string[];
}

/**
 * 索引统计信息
 */
export interface IndexStats {
  /** 文件数量 */
  fileCount: number;

  /** Chunk 数量 */
  chunkCount: number;

  /** 总 Token 数 */
  totalTokens: number;
}

/**
 * 文件元数据
 */
export interface FileMetadata {
  /** 文件名 */
  name: string;

  /** 文件类型 */
  type: string;

  /** 文件大小（字节） */
  size: number;

  /** 文件哈希 */
  hash: string;

  /** 文件 ID */
  fileId: string;

  /** 索引时间 */
  indexedAt: string;

  /** Chunk 数量 */
  chunkCount: number;

  /** Chunk ID 列表 */
  chunkIds: string[];

  /** 文件摘要 */
  summary: string;
}

/**
 * 子目录信息
 */
export interface SubdirectoryInfo {
  /** 子目录名 */
  name: string;

  /** 是否已索引 */
  hasIndex: boolean;

  /** 子目录摘要 */
  summary: string | null;

  /** 最后更新时间 */
  lastUpdated: string | null;
}

/**
 * 全局注册表（~/.agent_fs/registry.json）
 */
export interface Registry {
  /** 版本号 */
  version: string;

  /** Embedding 模型名称 */
  embeddingModel: string;

  /** Embedding 向量维度 */
  embeddingDimension: number;

  /** 已索引目录列表 */
  indexedDirectories: RegisteredDirectory[];
}

/**
 * 已注册目录
 */
export interface RegisteredDirectory {
  /** 目录路径 */
  path: string;

  /** 别名 */
  alias: string;

  /** 目录 ID */
  dirId: string;

  /** 目录摘要 */
  summary: string;

  /** 最后更新时间 */
  lastUpdated: string;

  /** 文件数量 */
  fileCount: number;

  /** Chunk 数量 */
  chunkCount: number;

  /** 是否有效 */
  valid: boolean;
}
```

**Step 2: 更新 index.ts**

```typescript
// @agent-fs/core
// 核心类型定义导出

export const VERSION = '0.1.0';

// Plugin types
export type {
  DocumentPlugin,
  DocumentConversionResult,
  PositionMapping,
  LocatorInfo,
} from './types/plugin';

// Chunk types
export type { Chunk, ChunkMetadata, ChunkResult, ChunkerOptions } from './types/chunk';

// Config types
export type {
  Config,
  LLMConfig,
  EmbeddingConfig,
  LocalEmbeddingConfig,
  APIEmbeddingConfig,
  RerankConfig,
  IndexingConfig,
  SearchConfig,
} from './types/config';

// Search types
export type {
  SearchResult,
  SearchOptions,
  SearchFilters,
  SearchMeta,
  SearchResponse,
} from './types/search';

// Index types
export type {
  IndexMetadata,
  IndexStats,
  FileMetadata,
  SubdirectoryInfo,
  Registry,
  RegisteredDirectory,
} from './types/index-meta';
```

**Step 3: 验证编译**

Run: `pnpm --filter @agent-fs/core build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): add Index and Registry type definitions"
```

---

## Task 11: 定义 Storage 类型

**Files:**
- Create: `packages/core/src/types/storage.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: 创建 storage.ts**

```typescript
/**
 * 向量文档（LanceDB 存储）
 */
export interface VectorDocument {
  /** Chunk ID */
  chunkId: string;

  /** 文件 ID */
  fileId: string;

  /** 目录 ID */
  dirId: string;

  /** 相对路径 */
  relPath: string;

  /** 绝对路径 */
  filePath: string;

  /** Chunk 内容 */
  content: string;

  /** Chunk 摘要 */
  summary: string;

  /** 内容向量 */
  contentVector: number[];

  /** 摘要向量 */
  summaryVector: number[];

  /** 原文定位符 */
  locator: string;

  /** 索引时间 */
  indexedAt: string;

  /** 删除时间（软删除） */
  deletedAt: string | null;
}

/**
 * BM25 文档
 */
export interface BM25Document {
  /** Chunk ID */
  chunkId: string;

  /** 文件 ID */
  fileId: string;

  /** 目录 ID */
  dirId: string;

  /** 文件路径 */
  filePath: string;

  /** Chunk 内容 */
  content: string;

  /** 分词后的 tokens */
  tokens: string[];

  /** 索引时间 */
  indexedAt: string;

  /** 删除时间（软删除） */
  deletedAt: string | null;
}

/**
 * 向量搜索结果
 */
export interface VectorSearchResult {
  /** Chunk ID */
  chunkId: string;

  /** 相似度分数 */
  score: number;

  /** 文档数据 */
  document: VectorDocument;
}

/**
 * BM25 搜索结果
 */
export interface BM25SearchResult {
  /** Chunk ID */
  chunkId: string;

  /** BM25 分数 */
  score: number;

  /** 文档数据 */
  document: BM25Document;
}
```

**Step 2: 更新 index.ts**

```typescript
// @agent-fs/core
// 核心类型定义导出

export const VERSION = '0.1.0';

// Plugin types
export type {
  DocumentPlugin,
  DocumentConversionResult,
  PositionMapping,
  LocatorInfo,
} from './types/plugin';

// Chunk types
export type { Chunk, ChunkMetadata, ChunkResult, ChunkerOptions } from './types/chunk';

// Config types
export type {
  Config,
  LLMConfig,
  EmbeddingConfig,
  LocalEmbeddingConfig,
  APIEmbeddingConfig,
  RerankConfig,
  IndexingConfig,
  SearchConfig,
} from './types/config';

// Search types
export type {
  SearchResult,
  SearchOptions,
  SearchFilters,
  SearchMeta,
  SearchResponse,
} from './types/search';

// Index types
export type {
  IndexMetadata,
  IndexStats,
  FileMetadata,
  SubdirectoryInfo,
  Registry,
  RegisteredDirectory,
} from './types/index-meta';

// Storage types
export type {
  VectorDocument,
  BM25Document,
  VectorSearchResult,
  BM25SearchResult,
} from './types/storage';
```

**Step 3: 验证编译**

Run: `pnpm --filter @agent-fs/core build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): add Storage type definitions"
```

---

## Task 12: 添加类型测试

**Files:**
- Create: `packages/core/src/types/plugin.test.ts`
- Create: `packages/core/src/types/chunk.test.ts`

**Step 1: 安装测试依赖**

Run: `pnpm add -D -w @types/node`
Expected: 成功安装

**Step 2: 创建 plugin.test.ts**

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { DocumentPlugin, PositionMapping } from './plugin';

describe('Plugin Types', () => {
  it('DocumentPlugin interface should have required properties', () => {
    expectTypeOf<DocumentPlugin>().toHaveProperty('name');
    expectTypeOf<DocumentPlugin>().toHaveProperty('supportedExtensions');
    expectTypeOf<DocumentPlugin>().toHaveProperty('toMarkdown');
  });

  it('PositionMapping should have correct structure', () => {
    const mapping: PositionMapping = {
      markdownRange: { startLine: 1, endLine: 10 },
      originalLocator: 'page:1',
    };
    expectTypeOf(mapping.markdownRange.startLine).toBeNumber();
    expectTypeOf(mapping.originalLocator).toBeString();
  });
});
```

**Step 3: 创建 chunk.test.ts**

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { Chunk, ChunkerOptions } from './chunk';

describe('Chunk Types', () => {
  it('Chunk interface should have required properties', () => {
    expectTypeOf<Chunk>().toHaveProperty('id');
    expectTypeOf<Chunk>().toHaveProperty('content');
    expectTypeOf<Chunk>().toHaveProperty('summary');
    expectTypeOf<Chunk>().toHaveProperty('tokenCount');
  });

  it('ChunkerOptions should have min and max tokens', () => {
    const options: ChunkerOptions = {
      minTokens: 600,
      maxTokens: 1200,
      overlapRatio: 0.1,
    };
    expectTypeOf(options.minTokens).toBeNumber();
    expectTypeOf(options.maxTokens).toBeNumber();
  });
});
```

**Step 4: 运行测试**

Run: `pnpm test`
Expected: 测试通过

**Step 5: Commit**

```bash
git add packages/core/src/types/*.test.ts package.json pnpm-lock.yaml
git commit -m "test(core): add type tests for plugin and chunk"
```

---

## Task 13: 更新根 tsconfig.json

**Files:**
- Modify: `tsconfig.json`

**Step 1: 更新 tsconfig.json 引用**

```json
{
  "files": [],
  "references": [
    { "path": "packages/core" }
  ]
}
```

**Step 2: 验证项目级编译**

Run: `pnpm build`
Expected: 编译成功

**Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "chore: update root tsconfig references"
```

---

## Task 14: 添加 .gitignore

**Files:**
- Create: `.gitignore`

**Step 1: 创建 .gitignore**

```
# Dependencies
node_modules/

# Build outputs
dist/
*.tsbuildinfo

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Test coverage
coverage/

# Environment
.env
.env.local
.env.*.local

# Electron
out/
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add .gitignore"
```

---

## Task 15: 最终验证

**Step 1: 清理并重新构建**

Run: `pnpm clean && pnpm install && pnpm build`
Expected: 全部成功

**Step 2: 运行测试**

Run: `pnpm test`
Expected: 测试通过

**Step 3: 运行 lint**

Run: `pnpm lint`
Expected: 无错误

**Step 4: 验证类型导出**

创建临时测试文件验证导出：

```typescript
// 临时验证（不需要提交）
import type {
  DocumentPlugin,
  Chunk,
  Config,
  SearchResult,
  IndexMetadata,
  VectorDocument,
} from '@agent-fs/core';
```

**Step 5: 最终 Commit（如有遗漏）**

```bash
git status
# 如有未提交的更改，提交它们
```

---

## 完成检查清单

- [ ] `pnpm install` 成功
- [ ] `pnpm build` 成功
- [ ] `pnpm test` 通过
- [ ] `pnpm lint` 无错误
- [ ] `@agent-fs/core` 导出所有类型
- [ ] Git 历史清晰，每个 Task 一个 commit

---

## 下一步

Plan A 完成后，可以并行开始以下计划：
- [B1] config
- [B2] chunker
- [B3] bm25
- [B4] plugin-md
- [P1] plugin-pdf

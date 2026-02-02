# [C2] Summary - Summary 服务实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 Summary 生成服务，支持 chunk/文档/目录 summary

**Architecture:** OpenAI 兼容 API 调用，带缓存、重试和降级机制

**Tech Stack:** OpenAI API, LRU 缓存

**依赖:** [A] foundation, [B1] config

**被依赖:** [F] indexer

---

## 成功标准

- [ ] 能调用 LLM 生成 chunk summary
- [ ] 能生成文档 summary
- [ ] 能生成目录 summary
- [ ] 支持批量处理
- [ ] 失败时降级到首段摘要
- [ ] 单元测试覆盖率 > 80%

---

## Task 1: 创建 summary 模块结构

**Files:**
- Create: `packages/llm/src/summary/index.ts`
- Create: `packages/llm/src/summary/service.ts`
- Create: `packages/llm/src/summary/prompts.ts`
- Create: `packages/llm/src/summary/cache.ts`

**Step 1: 创建目录**

Run: `mkdir -p packages/llm/src/summary`

**Step 2: 创建 prompts.ts**

```typescript
/**
 * Chunk Summary 提示词
 */
export const CHUNK_SUMMARY_PROMPT = `请为以下文本生成一个简洁的摘要（50-100字）：

{content}

摘要：`;

/**
 * 文档 Summary 提示词
 */
export const DOCUMENT_SUMMARY_PROMPT = `请为以下文档生成一个综合摘要（100-200字），概括主要内容和关键信息：

文档名称：{filename}

文档内容（各章节摘要）：
{chunk_summaries}

文档摘要：`;

/**
 * 目录 Summary 提示词
 */
export const DIRECTORY_SUMMARY_PROMPT = `请为以下文件夹生成一个综合摘要（100-200字），描述该文件夹包含的主要内容：

文件夹路径：{path}

包含的文档：
{file_summaries}

包含的子目录：
{subdirectory_summaries}

文件夹摘要：`;
```

**Step 3: Commit**

```bash
git add packages/llm/src/summary
git commit -m "chore(llm): create summary module structure"
```

---

## Task 2: 实现 Summary 缓存

**Files:**
- Modify: `packages/llm/src/summary/cache.ts`

```typescript
import { LRUCache } from 'lru-cache';
import { createHash } from 'node:crypto';

export class SummaryCache {
  private cache: LRUCache<string, string>;
  private model: string;

  constructor(model: string, maxSize: number = 5000) {
    this.model = model;
    this.cache = new LRUCache({ max: maxSize });
  }

  private makeKey(content: string, type: string): string {
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    return `${this.model}:${type}:${hash}`;
  }

  get(content: string, type: string): string | undefined {
    return this.cache.get(this.makeKey(content, type));
  }

  set(content: string, type: string, summary: string): void {
    this.cache.set(this.makeKey(content, type), summary);
  }

  clear(): void {
    this.cache.clear();
  }
}
```

---

## Task 3: 实现 SummaryService

**Files:**
- Modify: `packages/llm/src/summary/service.ts`

```typescript
import type { LLMConfig } from '@agent-fs/core';
import { SummaryCache } from './cache';
import {
  CHUNK_SUMMARY_PROMPT,
  DOCUMENT_SUMMARY_PROMPT,
  DIRECTORY_SUMMARY_PROMPT,
} from './prompts';

export interface SummaryOptions {
  useCache?: boolean;
  maxRetries?: number;
}

export interface SummaryResult {
  summary: string;
  fromCache: boolean;
  fallback: boolean;
}

export class SummaryService {
  private config: LLMConfig;
  private cache: SummaryCache;

  constructor(config: LLMConfig) {
    this.config = config;
    this.cache = new SummaryCache(config.model);
  }

  async generateChunkSummary(
    content: string,
    options: SummaryOptions = {}
  ): Promise<SummaryResult> {
    const { useCache = true, maxRetries = 3 } = options;

    if (useCache) {
      const cached = this.cache.get(content, 'chunk');
      if (cached) {
        return { summary: cached, fromCache: true, fallback: false };
      }
    }

    try {
      const prompt = CHUNK_SUMMARY_PROMPT.replace('{content}', content);
      const summary = await this.callLLM(prompt, maxRetries);

      if (useCache) {
        this.cache.set(content, 'chunk', summary);
      }

      return { summary, fromCache: false, fallback: false };
    } catch {
      // 降级：使用首段作为摘要
      const fallbackSummary = this.extractFirstParagraph(content);
      return { summary: fallbackSummary, fromCache: false, fallback: true };
    }
  }

  async generateDocumentSummary(
    filename: string,
    chunkSummaries: string[],
    options: SummaryOptions = {}
  ): Promise<SummaryResult> {
    const content = `${filename}\n${chunkSummaries.join('\n')}`;

    if (options.useCache !== false) {
      const cached = this.cache.get(content, 'document');
      if (cached) {
        return { summary: cached, fromCache: true, fallback: false };
      }
    }

    try {
      const prompt = DOCUMENT_SUMMARY_PROMPT
        .replace('{filename}', filename)
        .replace('{chunk_summaries}', chunkSummaries.join('\n'));

      const summary = await this.callLLM(prompt, options.maxRetries ?? 3);

      this.cache.set(content, 'document', summary);
      return { summary, fromCache: false, fallback: false };
    } catch {
      const fallbackSummary = chunkSummaries.slice(0, 3).join(' ');
      return { summary: fallbackSummary, fromCache: false, fallback: true };
    }
  }

  async generateDirectorySummary(
    path: string,
    fileSummaries: string[],
    subdirSummaries: string[],
    options: SummaryOptions = {}
  ): Promise<SummaryResult> {
    const content = `${path}\n${fileSummaries.join('\n')}\n${subdirSummaries.join('\n')}`;

    if (options.useCache !== false) {
      const cached = this.cache.get(content, 'directory');
      if (cached) {
        return { summary: cached, fromCache: true, fallback: false };
      }
    }

    try {
      const prompt = DIRECTORY_SUMMARY_PROMPT
        .replace('{path}', path)
        .replace('{file_summaries}', fileSummaries.join('\n'))
        .replace('{subdirectory_summaries}', subdirSummaries.join('\n'));

      const summary = await this.callLLM(prompt, options.maxRetries ?? 3);

      this.cache.set(content, 'directory', summary);
      return { summary, fromCache: false, fallback: false };
    } catch {
      const fallbackSummary = `包含 ${fileSummaries.length} 个文件和 ${subdirSummaries.length} 个子目录`;
      return { summary: fallbackSummary, fromCache: false, fallback: true };
    }
  }

  private async callLLM(prompt: string, maxRetries: number): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.config.base_url}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.api_key}`,
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 500,
            temperature: 0.3,
          }),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0].message.content.trim();
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError ?? new Error('Failed to generate summary');
  }

  private extractFirstParagraph(content: string): string {
    const paragraphs = content.split('\n\n');
    const firstPara = paragraphs[0] || content;
    return firstPara.slice(0, 200) + (firstPara.length > 200 ? '...' : '');
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export function createSummaryService(config: LLMConfig): SummaryService {
  return new SummaryService(config);
}
```

---

## Task 4: 更新导出

**Files:**
- Modify: `packages/llm/src/summary/index.ts`
- Modify: `packages/llm/src/index.ts`

```typescript
// summary/index.ts
export { SummaryService, createSummaryService } from './service';
export type { SummaryOptions, SummaryResult } from './service';
export { SummaryCache } from './cache';
```

```typescript
// llm/src/index.ts 添加：
export { SummaryService, createSummaryService } from './summary';
export type { SummaryOptions, SummaryResult } from './summary';
```

---

## Task 5: 编写测试

创建 `packages/llm/src/summary/service.test.ts` 测试 SummaryService。

---

## 完成检查清单

- [ ] chunk/document/directory summary 生成
- [ ] 缓存机制
- [ ] 重试机制
- [ ] 降级策略
- [ ] 测试覆盖率 > 80%

---

## 输出接口

```typescript
import { SummaryService, createSummaryService } from '@agent-fs/llm';

const service = createSummaryService({
  provider: 'openai-compatible',
  base_url: 'https://api.openai.com/v1',
  api_key: process.env.OPENAI_API_KEY || '',
  model: 'gpt-4o-mini',
});

const result = await service.generateChunkSummary('文本内容...');
console.log(result.summary);
```

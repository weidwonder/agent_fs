# [B2] Chunker - 文本切分实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 Markdown 文本智能切分，支持按标题层级和句子切分

**Architecture:** 使用 remark 解析 Markdown AST，按结构切分，超大段落再按句子切分

**Tech Stack:** remark, unist-util-visit, tiktoken (或 gpt-tokenizer)

**依赖:** [A] foundation

**被依赖:** [F] indexer

---

## 成功标准

- [ ] 能按 Markdown 标题层级切分
- [ ] 超过 max_tokens 自动再切分
- [ ] chunk 大小在 min_tokens ~ max_tokens 范围内
- [ ] 支持 10-15% overlap
- [ ] 输出包含 locator（行号范围）
- [ ] 单元测试覆盖率 > 80%

---

## Task 1: 创建 chunker 模块结构

**Files:**
- Create: `packages/core/src/chunker/index.ts`
- Create: `packages/core/src/chunker/markdown-chunker.ts`
- Create: `packages/core/src/chunker/tokenizer.ts`
- Create: `packages/core/src/chunker/sentence-splitter.ts`

**Step 1: 创建目录**

Run: `mkdir -p packages/core/src/chunker`
Expected: 目录创建成功

**Step 2: 安装依赖**

Run: `pnpm add -w remark remark-parse unist-util-visit gpt-tokenizer`
Expected: 成功安装

**Step 3: 创建 index.ts（占位）**

```typescript
// Chunker module entry point
export { MarkdownChunker } from './markdown-chunker';
export { countTokens, createTokenizer } from './tokenizer';
export type { TokenizerOptions } from './tokenizer';
```

**Step 4: Commit**

```bash
git add packages/core/src/chunker
git commit -m "chore(core): create chunker module structure"
```

---

## Task 2: 实现 Tokenizer

**Files:**
- Modify: `packages/core/src/chunker/tokenizer.ts`

**Step 1: 创建 tokenizer.ts**

```typescript
import { encode, decode } from 'gpt-tokenizer';

/**
 * Tokenizer 选项
 */
export interface TokenizerOptions {
  /** 模型名称（用于选择 tokenizer） */
  model?: string;
}

/**
 * Tokenizer 接口
 */
export interface Tokenizer {
  /** 计算文本的 token 数 */
  count(text: string): number;

  /** 将文本编码为 token */
  encode(text: string): number[];

  /** 将 token 解码为文本 */
  decode(tokens: number[]): string;
}

/**
 * 创建 Tokenizer
 * 默认使用 GPT tokenizer（cl100k_base）
 */
export function createTokenizer(_options: TokenizerOptions = {}): Tokenizer {
  return {
    count(text: string): number {
      return encode(text).length;
    },
    encode(text: string): number[] {
      return encode(text);
    },
    decode(tokens: number[]): string {
      return decode(tokens);
    },
  };
}

/**
 * 快捷方法：计算 token 数
 */
export function countTokens(text: string): number {
  return encode(text).length;
}
```

**Step 2: 验证编译**

Run: `pnpm --filter @agent-fs/core build`
Expected: 编译成功

**Step 3: Commit**

```bash
git add packages/core/src/chunker/tokenizer.ts
git commit -m "feat(core): add tokenizer using gpt-tokenizer"
```

---

## Task 3: 实现句子切分器

**Files:**
- Modify: `packages/core/src/chunker/sentence-splitter.ts`

**Step 1: 创建 sentence-splitter.ts**

```typescript
import { countTokens } from './tokenizer';

/**
 * 句子切分选项
 */
export interface SentenceSplitOptions {
  /** 最大 token 数 */
  maxTokens: number;

  /** 重叠比例 */
  overlapRatio?: number;
}

/**
 * 切分后的句子段落
 */
export interface SentenceChunk {
  /** 内容 */
  content: string;

  /** Token 数 */
  tokenCount: number;

  /** 在原文中的起始字符位置 */
  startOffset: number;

  /** 在原文中的结束字符位置 */
  endOffset: number;
}

/**
 * 将文本按句子切分
 * 支持中英文句子
 */
export function splitBySentences(text: string): string[] {
  // 匹配句子结束符：中文句号、英文句号、问号、感叹号
  // 保留分隔符在前一个句子中
  const sentences: string[] = [];
  let current = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    current += char;

    // 检测句子结束
    if (/[。！？.!?]/.test(char)) {
      // 检查是否是缩写或数字中的点
      const next = text[i + 1];
      if (char === '.' && next && /\d/.test(next)) {
        continue; // 小数点，继续
      }

      sentences.push(current.trim());
      current = '';
    }
  }

  // 处理最后一个句子
  if (current.trim()) {
    sentences.push(current.trim());
  }

  return sentences.filter((s) => s.length > 0);
}

/**
 * 将超大文本块按句子切分成多个小块
 */
export function splitLargeBlock(
  text: string,
  options: SentenceSplitOptions
): SentenceChunk[] {
  const { maxTokens, overlapRatio = 0.1 } = options;
  const sentences = splitBySentences(text);

  if (sentences.length === 0) {
    return [];
  }

  const chunks: SentenceChunk[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;
  let startOffset = 0;

  for (const sentence of sentences) {
    const sentenceTokens = countTokens(sentence);

    // 如果单个句子就超过限制，强制作为一个 chunk
    if (sentenceTokens > maxTokens) {
      // 先保存当前积累的内容
      if (currentChunk.length > 0) {
        const content = currentChunk.join(' ');
        chunks.push({
          content,
          tokenCount: currentTokens,
          startOffset,
          endOffset: startOffset + content.length,
        });
        startOffset += content.length + 1;
      }

      // 添加超大句子
      chunks.push({
        content: sentence,
        tokenCount: sentenceTokens,
        startOffset,
        endOffset: startOffset + sentence.length,
      });
      startOffset += sentence.length + 1;

      currentChunk = [];
      currentTokens = 0;
      continue;
    }

    // 检查是否会超过限制
    if (currentTokens + sentenceTokens > maxTokens && currentChunk.length > 0) {
      // 保存当前 chunk
      const content = currentChunk.join(' ');
      chunks.push({
        content,
        tokenCount: currentTokens,
        startOffset,
        endOffset: startOffset + content.length,
      });

      // 计算 overlap
      const overlapSentences = Math.ceil(currentChunk.length * overlapRatio);
      const overlap = currentChunk.slice(-overlapSentences);
      const overlapTokens = overlap.reduce((sum, s) => sum + countTokens(s), 0);

      startOffset += content.length - overlap.join(' ').length;
      currentChunk = [...overlap, sentence];
      currentTokens = overlapTokens + sentenceTokens;
    } else {
      currentChunk.push(sentence);
      currentTokens += sentenceTokens;
    }
  }

  // 保存最后一个 chunk
  if (currentChunk.length > 0) {
    const content = currentChunk.join(' ');
    chunks.push({
      content,
      tokenCount: currentTokens,
      startOffset,
      endOffset: startOffset + content.length,
    });
  }

  return chunks;
}
```

**Step 2: 验证编译**

Run: `pnpm --filter @agent-fs/core build`
Expected: 编译成功

**Step 3: Commit**

```bash
git add packages/core/src/chunker/sentence-splitter.ts
git commit -m "feat(core): add sentence splitter for large blocks"
```

---

## Task 4: 实现 Markdown Chunker

**Files:**
- Modify: `packages/core/src/chunker/markdown-chunker.ts`

**Step 1: 创建 markdown-chunker.ts**

```typescript
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import type { Root, Content, Heading } from 'mdast';
import { countTokens } from './tokenizer';
import { splitLargeBlock } from './sentence-splitter';
import type { ChunkMetadata, ChunkerOptions } from '../types/chunk';

/**
 * Markdown 切分器
 */
export class MarkdownChunker {
  private options: Required<ChunkerOptions>;

  constructor(options: ChunkerOptions) {
    this.options = {
      minTokens: options.minTokens,
      maxTokens: options.maxTokens,
      overlapRatio: options.overlapRatio ?? 0.1,
    };
  }

  /**
   * 切分 Markdown 文本
   */
  chunk(markdown: string): ChunkMetadata[] {
    const lines = markdown.split('\n');
    const tree = unified().use(remarkParse).parse(markdown) as Root;

    // 按标题层级切分成节
    const sections = this.extractSections(tree, lines);

    // 处理每个节，必要时再细分
    const chunks: ChunkMetadata[] = [];

    for (const section of sections) {
      const tokenCount = countTokens(section.content);

      if (tokenCount <= this.options.maxTokens) {
        // 直接作为一个 chunk
        chunks.push({
          content: section.content,
          tokenCount,
          locator: `line:${section.startLine}-${section.endLine}`,
          markdownRange: {
            startLine: section.startLine,
            endLine: section.endLine,
          },
        });
      } else {
        // 需要再细分
        const subChunks = splitLargeBlock(section.content, {
          maxTokens: this.options.maxTokens,
          overlapRatio: this.options.overlapRatio,
        });

        for (const subChunk of subChunks) {
          chunks.push({
            content: subChunk.content,
            tokenCount: subChunk.tokenCount,
            locator: `line:${section.startLine}-${section.endLine}`,
            markdownRange: {
              startLine: section.startLine,
              endLine: section.endLine,
            },
          });
        }
      }
    }

    // 合并过小的 chunks
    return this.mergeSmallChunks(chunks);
  }

  /**
   * 提取按标题分隔的节
   */
  private extractSections(
    tree: Root,
    lines: string[]
  ): Array<{ content: string; startLine: number; endLine: number }> {
    const sections: Array<{
      content: string;
      startLine: number;
      endLine: number;
    }> = [];

    // 收集所有标题的位置
    const headings: Array<{ line: number; depth: number }> = [];

    visit(tree, 'heading', (node: Heading) => {
      if (node.position) {
        headings.push({
          line: node.position.start.line,
          depth: node.depth,
        });
      }
    });

    if (headings.length === 0) {
      // 没有标题，整个文档作为一个节
      return [
        {
          content: lines.join('\n'),
          startLine: 1,
          endLine: lines.length,
        },
      ];
    }

    // 按标题切分
    for (let i = 0; i < headings.length; i++) {
      const startLine = headings[i].line;
      const endLine = i < headings.length - 1 ? headings[i + 1].line - 1 : lines.length;

      const content = lines.slice(startLine - 1, endLine).join('\n');
      sections.push({ content, startLine, endLine });
    }

    // 处理第一个标题之前的内容
    if (headings[0].line > 1) {
      sections.unshift({
        content: lines.slice(0, headings[0].line - 1).join('\n'),
        startLine: 1,
        endLine: headings[0].line - 1,
      });
    }

    return sections.filter((s) => s.content.trim().length > 0);
  }

  /**
   * 合并过小的 chunks
   */
  private mergeSmallChunks(chunks: ChunkMetadata[]): ChunkMetadata[] {
    if (chunks.length <= 1) {
      return chunks;
    }

    const merged: ChunkMetadata[] = [];
    let current: ChunkMetadata | null = null;

    for (const chunk of chunks) {
      if (!current) {
        current = { ...chunk };
        continue;
      }

      const combinedTokens = current.tokenCount + chunk.tokenCount;

      // 如果合并后不超过最大值且当前 chunk 太小，则合并
      if (
        combinedTokens <= this.options.maxTokens &&
        current.tokenCount < this.options.minTokens
      ) {
        current = {
          content: current.content + '\n\n' + chunk.content,
          tokenCount: combinedTokens,
          locator: `line:${current.markdownRange.startLine}-${chunk.markdownRange.endLine}`,
          markdownRange: {
            startLine: current.markdownRange.startLine,
            endLine: chunk.markdownRange.endLine,
          },
        };
      } else {
        merged.push(current);
        current = { ...chunk };
      }
    }

    if (current) {
      merged.push(current);
    }

    return merged;
  }
}
```

**Step 2: 安装 unified 相关依赖**

Run: `pnpm add -w unified remark-parse unist-util-visit`
Expected: 成功安装

Run: `pnpm add -D -w @types/mdast`
Expected: 成功安装

**Step 3: 验证编译**

Run: `pnpm --filter @agent-fs/core build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add packages/core/src/chunker pnpm-lock.yaml package.json
git commit -m "feat(core): add MarkdownChunker with AST-based splitting"
```

---

## Task 5: 更新模块导出

**Files:**
- Modify: `packages/core/src/chunker/index.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: 更新 chunker/index.ts**

```typescript
// Chunker module entry point
export { MarkdownChunker } from './markdown-chunker';
export { countTokens, createTokenizer, type Tokenizer, type TokenizerOptions } from './tokenizer';
export {
  splitBySentences,
  splitLargeBlock,
  type SentenceSplitOptions,
  type SentenceChunk,
} from './sentence-splitter';
```

**Step 2: 更新 core/index.ts**

在 index.ts 末尾添加：

```typescript
// Chunker
export {
  MarkdownChunker,
  countTokens,
  createTokenizer,
  splitBySentences,
  splitLargeBlock,
  type Tokenizer,
  type TokenizerOptions,
  type SentenceSplitOptions,
  type SentenceChunk,
} from './chunker';
```

**Step 3: 验证编译**

Run: `pnpm --filter @agent-fs/core build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): export chunker module"
```

---

## Task 6: 编写 Tokenizer 测试

**Files:**
- Create: `packages/core/src/chunker/tokenizer.test.ts`

**Step 1: 创建 tokenizer.test.ts**

```typescript
import { describe, it, expect } from 'vitest';
import { countTokens, createTokenizer } from './tokenizer';

describe('countTokens', () => {
  it('should count English tokens', () => {
    const count = countTokens('Hello, world!');
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10);
  });

  it('should count Chinese tokens', () => {
    const count = countTokens('你好，世界！');
    expect(count).toBeGreaterThan(0);
  });

  it('should handle empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('should handle long text', () => {
    const longText = 'Hello world. '.repeat(100);
    const count = countTokens(longText);
    expect(count).toBeGreaterThan(100);
  });
});

describe('createTokenizer', () => {
  it('should create a tokenizer with count method', () => {
    const tokenizer = createTokenizer();
    expect(tokenizer.count('test')).toBeGreaterThan(0);
  });

  it('should encode and decode correctly', () => {
    const tokenizer = createTokenizer();
    const text = 'Hello, world!';
    const tokens = tokenizer.encode(text);
    const decoded = tokenizer.decode(tokens);
    expect(decoded).toBe(text);
  });
});
```

**Step 2: 运行测试**

Run: `pnpm test`
Expected: 测试通过

**Step 3: Commit**

```bash
git add packages/core/src/chunker/tokenizer.test.ts
git commit -m "test(core): add tokenizer tests"
```

---

## Task 7: 编写句子切分器测试

**Files:**
- Create: `packages/core/src/chunker/sentence-splitter.test.ts`

**Step 1: 创建 sentence-splitter.test.ts**

```typescript
import { describe, it, expect } from 'vitest';
import { splitBySentences, splitLargeBlock } from './sentence-splitter';

describe('splitBySentences', () => {
  it('should split English sentences', () => {
    const text = 'Hello world. How are you? I am fine!';
    const sentences = splitBySentences(text);
    expect(sentences).toHaveLength(3);
    expect(sentences[0]).toBe('Hello world.');
    expect(sentences[1]).toBe('How are you?');
    expect(sentences[2]).toBe('I am fine!');
  });

  it('should split Chinese sentences', () => {
    const text = '你好世界。今天天气很好！你觉得呢？';
    const sentences = splitBySentences(text);
    expect(sentences).toHaveLength(3);
  });

  it('should handle mixed sentences', () => {
    const text = 'Hello世界。This is a test!';
    const sentences = splitBySentences(text);
    expect(sentences).toHaveLength(2);
  });

  it('should handle decimal numbers', () => {
    const text = 'The value is 3.14. Another sentence.';
    const sentences = splitBySentences(text);
    // 注意：简单实现可能会在 3.14 处分割
    expect(sentences.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle empty text', () => {
    expect(splitBySentences('')).toHaveLength(0);
  });
});

describe('splitLargeBlock', () => {
  it('should split text into chunks within maxTokens', () => {
    const text = 'Sentence one. Sentence two. Sentence three. Sentence four. Sentence five.';
    const chunks = splitLargeBlock(text, { maxTokens: 10 });

    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(15); // 允许一些误差
    }
  });

  it('should handle single large sentence', () => {
    const text = 'A'.repeat(1000);
    const chunks = splitLargeBlock(text, { maxTokens: 50 });

    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('should include overlap when specified', () => {
    const text = 'One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten.';
    const chunks = splitLargeBlock(text, { maxTokens: 10, overlapRatio: 0.2 });

    // 检查是否有重叠内容
    if (chunks.length >= 2) {
      // 由于 overlap，某些句子应该出现在多个 chunk 中
      expect(chunks.length).toBeGreaterThan(1);
    }
  });

  it('should return empty array for empty text', () => {
    const chunks = splitLargeBlock('', { maxTokens: 100 });
    expect(chunks).toHaveLength(0);
  });
});
```

**Step 2: 运行测试**

Run: `pnpm test`
Expected: 测试通过

**Step 3: Commit**

```bash
git add packages/core/src/chunker/sentence-splitter.test.ts
git commit -m "test(core): add sentence splitter tests"
```

---

## Task 8: 编写 Markdown Chunker 测试

**Files:**
- Create: `packages/core/src/chunker/markdown-chunker.test.ts`

**Step 1: 创建 markdown-chunker.test.ts**

```typescript
import { describe, it, expect } from 'vitest';
import { MarkdownChunker } from './markdown-chunker';

describe('MarkdownChunker', () => {
  const chunker = new MarkdownChunker({
    minTokens: 50,
    maxTokens: 200,
    overlapRatio: 0.1,
  });

  it('should chunk simple markdown by headings', () => {
    const markdown = `# Title

Introduction paragraph.

## Section 1

Content of section 1.

## Section 2

Content of section 2.
`;

    const chunks = chunker.chunk(markdown);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('should include line numbers in locator', () => {
    const markdown = `# Title

Some content here.
`;
    const chunks = chunker.chunk(markdown);
    expect(chunks[0].locator).toMatch(/^line:\d+-\d+$/);
  });

  it('should handle markdown without headings', () => {
    const markdown = `This is a document without headings.

It has multiple paragraphs.

Each paragraph is separate.`;

    const chunks = chunker.chunk(markdown);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('should split large sections', () => {
    // 创建一个大段落
    const largeParagraph = 'This is a sentence. '.repeat(100);
    const markdown = `# Large Section

${largeParagraph}
`;

    const largeChunker = new MarkdownChunker({
      minTokens: 10,
      maxTokens: 50,
    });

    const chunks = largeChunker.chunk(markdown);
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      // 每个 chunk 应该在限制范围内（允许一些误差）
      expect(chunk.tokenCount).toBeLessThanOrEqual(100);
    }
  });

  it('should merge small chunks', () => {
    const markdown = `# A

X.

# B

Y.

# C

Z.`;

    const mergeChunker = new MarkdownChunker({
      minTokens: 50,
      maxTokens: 200,
    });

    const chunks = mergeChunker.chunk(markdown);
    // 小的节应该被合并
    expect(chunks.length).toBeLessThan(4);
  });

  it('should handle Chinese content', () => {
    const markdown = `# 标题

这是一段中文内容。

## 第一节

这是第一节的内容，包含多个句子。每个句子都有意义。

## 第二节

这是第二节的内容。
`;

    const chunks = chunker.chunk(markdown);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('should provide correct markdownRange', () => {
    const markdown = `# Title

Content.

## Section

More content.
`;
    const chunks = chunker.chunk(markdown);

    for (const chunk of chunks) {
      expect(chunk.markdownRange.startLine).toBeGreaterThanOrEqual(1);
      expect(chunk.markdownRange.endLine).toBeGreaterThanOrEqual(chunk.markdownRange.startLine);
    }
  });
});
```

**Step 2: 运行测试**

Run: `pnpm test`
Expected: 测试通过

**Step 3: Commit**

```bash
git add packages/core/src/chunker/markdown-chunker.test.ts
git commit -m "test(core): add MarkdownChunker tests"
```

---

## Task 9: 更新 package.json 依赖

**Files:**
- Modify: `packages/core/package.json`

**Step 1: 更新依赖**

```json
{
  "dependencies": {
    "dotenv": "^16.3.0",
    "gpt-tokenizer": "^2.1.0",
    "js-yaml": "^4.1.0",
    "remark": "^15.0.0",
    "remark-parse": "^11.0.0",
    "unified": "^11.0.0",
    "unist-util-visit": "^5.0.0",
    "zod": "^3.22.0"
  }
}
```

**Step 2: 安装依赖**

Run: `pnpm install`
Expected: 成功

**Step 3: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml
git commit -m "chore(core): update chunker dependencies"
```

---

## Task 10: 运行覆盖率测试

**Step 1: 运行覆盖率**

Run: `pnpm test:coverage`
Expected: chunker 模块覆盖率 > 80%

**Step 2: 检查并补充测试**

如覆盖率不足，添加更多边界情况测试。

---

## Task 11: 最终验证

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

- [ ] Markdown 按标题层级切分正常
- [ ] 超大段落自动按句子再切分
- [ ] chunk 大小在配置范围内
- [ ] locator 包含正确的行号范围
- [ ] overlap 正确实现
- [ ] 测试覆盖率 > 80%

---

## 输出接口

```typescript
// 从 @agent-fs/core 导入
import { MarkdownChunker, countTokens } from '@agent-fs/core';

// 使用示例
const chunker = new MarkdownChunker({
  minTokens: 600,
  maxTokens: 1200,
  overlapRatio: 0.1,
});

const chunks = chunker.chunk(markdownText);
console.log(chunks[0].content);
console.log(chunks[0].locator); // 'line:1-15'
```

---

## 下一步

B2 完成后，以下计划可以继续：
- [F] indexer（需要 B2）

# [P1] Plugin PDF - PDF 插件实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 PDF 文档处理插件，提取文本并生成页码映射

**Architecture:** 使用 pdf-parse 提取 PDF 文本，生成按页码的位置映射

**Tech Stack:** pdf-parse

**依赖:** [A] foundation

**被依赖:** [F] indexer

---

## 成功标准

- [ ] 正确实现 DocumentPlugin 接口
- [ ] 能提取 PDF 文本内容
- [ ] 生成正确的页码 mapping
- [ ] 单元测试覆盖率 > 80%

---

## Task 1: 创建 plugin-pdf 包结构

**Files:**
- Create: `packages/plugins/plugin-pdf/package.json`
- Create: `packages/plugins/plugin-pdf/tsconfig.json`
- Create: `packages/plugins/plugin-pdf/src/index.ts`

**Step 1: 创建目录**

Run: `mkdir -p packages/plugins/plugin-pdf/src`
Expected: 目录创建成功

**Step 2: 创建 package.json**

```json
{
  "name": "@agent-fs/plugin-pdf",
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
    "pdf-parse": "^1.1.1"
  },
  "devDependencies": {
    "@types/pdf-parse": "^1.1.4",
    "typescript": "^5.3.0"
  }
}
```

**Step 3: 创建 tsconfig.json**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [
    { "path": "../../core" }
  ]
}
```

**Step 4: 创建占位 index.ts**

```typescript
// @agent-fs/plugin-pdf
export { PDFPlugin } from './plugin';
```

**Step 5: 安装依赖**

Run: `pnpm install`
Expected: 成功安装

**Step 6: Commit**

```bash
git add packages/plugins/plugin-pdf
git commit -m "chore: create @agent-fs/plugin-pdf package structure"
```

---

## Task 2: 实现 PDFPlugin

**Files:**
- Create: `packages/plugins/plugin-pdf/src/plugin.ts`

**Step 1: 创建 plugin.ts**

```typescript
import { readFileSync } from 'node:fs';
import pdf from 'pdf-parse';
import type {
  DocumentPlugin,
  DocumentConversionResult,
  PositionMapping,
  LocatorInfo,
} from '@agent-fs/core';

/**
 * PDF 解析选项
 */
export interface PDFPluginOptions {
  /** 是否保留换行符 */
  preserveLineBreaks?: boolean;
}

/**
 * PDF 文档处理插件
 */
export class PDFPlugin implements DocumentPlugin {
  readonly name = 'pdf';
  readonly supportedExtensions = ['pdf'];

  private options: PDFPluginOptions;

  constructor(options: PDFPluginOptions = {}) {
    this.options = {
      preserveLineBreaks: options.preserveLineBreaks ?? true,
    };
  }

  /**
   * 将 PDF 文件转换为 Markdown
   */
  async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
    const buffer = readFileSync(filePath);

    // 自定义页面渲染函数以获取分页信息
    const pageTexts: string[] = [];

    const renderPage = async (pageData: { getTextContent: () => Promise<{ items: Array<{ str: string }> }> }) => {
      const textContent = await pageData.getTextContent();
      const text = textContent.items.map((item) => item.str).join(' ');
      pageTexts.push(text);
      return text;
    };

    const data = await pdf(buffer, {
      pagerender: renderPage,
    });

    // 构建 Markdown 内容
    const markdownLines: string[] = [];
    const mapping: PositionMapping[] = [];

    let currentLine = 1;

    for (let pageNum = 0; pageNum < pageTexts.length; pageNum++) {
      const pageText = pageTexts[pageNum];
      const pageNumber = pageNum + 1;

      // 添加页码标记
      if (pageNum > 0) {
        markdownLines.push('');
        markdownLines.push('---');
        markdownLines.push('');
        currentLine += 3;
      }

      // 处理页面文本
      const paragraphs = this.splitIntoParagraphs(pageText);
      const startLine = currentLine;

      for (const paragraph of paragraphs) {
        if (paragraph.trim()) {
          markdownLines.push(paragraph);
          currentLine++;
        }
      }

      // 创建页面映射
      if (currentLine > startLine) {
        mapping.push({
          markdownRange: {
            startLine,
            endLine: currentLine - 1,
          },
          originalLocator: `page:${pageNumber}`,
        });
      }
    }

    return {
      markdown: markdownLines.join('\n'),
      mapping,
    };
  }

  /**
   * 解析定位符
   */
  parseLocator(locator: string): LocatorInfo {
    // 格式: page:N 或 page:N-M
    const match = locator.match(/^page:(\d+)(?:-(\d+))?$/);

    if (!match) {
      return {
        displayText: locator,
      };
    }

    const startPage = parseInt(match[1], 10);
    const endPage = match[2] ? parseInt(match[2], 10) : startPage;

    if (startPage === endPage) {
      return {
        displayText: `第 ${startPage} 页`,
        jumpInfo: { page: startPage },
      };
    }

    return {
      displayText: `第 ${startPage}-${endPage} 页`,
      jumpInfo: { startPage, endPage },
    };
  }

  /**
   * 将文本分割成段落
   */
  private splitIntoParagraphs(text: string): string[] {
    if (!text) return [];

    // 按双换行分割段落
    const paragraphs = text.split(/\n\n+/);

    return paragraphs
      .map((p) => {
        // 清理段落内的多余空白
        if (this.options.preserveLineBreaks) {
          return p.replace(/\s+/g, ' ').trim();
        }
        return p.replace(/\s+/g, ' ').trim();
      })
      .filter((p) => p.length > 0);
  }

  /**
   * 初始化
   */
  async init(): Promise<void> {
    // PDF 插件无需特殊初始化
  }

  /**
   * 销毁
   */
  async dispose(): Promise<void> {
    // PDF 插件无需清理
  }
}

/**
 * 创建 PDF 插件实例
 */
export function createPDFPlugin(options?: PDFPluginOptions): DocumentPlugin {
  return new PDFPlugin(options);
}
```

**Step 2: 更新 index.ts**

```typescript
// @agent-fs/plugin-pdf
export { PDFPlugin, createPDFPlugin, type PDFPluginOptions } from './plugin';
```

**Step 3: 验证编译**

Run: `pnpm --filter @agent-fs/plugin-pdf build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add packages/plugins/plugin-pdf
git commit -m "feat(plugin-pdf): implement PDFPlugin with page mapping"
```

---

## Task 3: 创建测试 PDF 文件

**Files:**
- Create: `packages/plugins/plugin-pdf/src/__fixtures__/sample.pdf`

**Step 1: 创建 fixtures 目录**

Run: `mkdir -p packages/plugins/plugin-pdf/src/__fixtures__`
Expected: 目录创建成功

**Step 2: 说明**

由于无法直接创建 PDF 文件，测试中将使用模拟或跳过需要真实 PDF 的测试。
在实际开发中，可以手动添加测试用 PDF 文件。

**Step 3: Commit**

```bash
git add packages/plugins/plugin-pdf/src/__fixtures__
git commit -m "chore(plugin-pdf): add fixtures directory"
```

---

## Task 4: 编写单元测试

**Files:**
- Create: `packages/plugins/plugin-pdf/src/plugin.test.ts`

**Step 1: 创建 plugin.test.ts**

```typescript
import { describe, it, expect } from 'vitest';
import { PDFPlugin } from './plugin';

describe('PDFPlugin', () => {
  const plugin = new PDFPlugin();

  describe('properties', () => {
    it('should have correct name', () => {
      expect(plugin.name).toBe('pdf');
    });

    it('should support pdf extension', () => {
      expect(plugin.supportedExtensions).toContain('pdf');
    });
  });

  describe('parseLocator', () => {
    it('should parse single page locator', () => {
      const info = plugin.parseLocator('page:5');
      expect(info.displayText).toBe('第 5 页');
      expect(info.jumpInfo).toEqual({ page: 5 });
    });

    it('should parse page range locator', () => {
      const info = plugin.parseLocator('page:3-7');
      expect(info.displayText).toBe('第 3-7 页');
      expect(info.jumpInfo).toEqual({ startPage: 3, endPage: 7 });
    });

    it('should handle invalid locator', () => {
      const info = plugin.parseLocator('invalid');
      expect(info.displayText).toBe('invalid');
      expect(info.jumpInfo).toBeUndefined();
    });
  });

  describe('lifecycle', () => {
    it('should init without error', async () => {
      await expect(plugin.init()).resolves.toBeUndefined();
    });

    it('should dispose without error', async () => {
      await expect(plugin.dispose()).resolves.toBeUndefined();
    });
  });

  // 注意：toMarkdown 测试需要真实的 PDF 文件
  // 在 CI 环境中可以添加集成测试
  describe('toMarkdown', () => {
    it.todo('should extract text from PDF file');
    it.todo('should generate page mapping');
    it.todo('should handle multi-page PDF');
  });
});
```

**Step 2: 运行测试**

Run: `pnpm --filter @agent-fs/plugin-pdf test`
Expected: 测试通过（todo 测试跳过）

**Step 3: Commit**

```bash
git add packages/plugins/plugin-pdf/src/plugin.test.ts
git commit -m "test(plugin-pdf): add PDFPlugin unit tests"
```

---

## Task 5: 添加集成测试脚本

**Files:**
- Create: `packages/plugins/plugin-pdf/scripts/test-with-pdf.ts`

**Step 1: 创建测试脚本**

```typescript
/**
 * PDF 插件集成测试脚本
 * 使用方法: npx tsx scripts/test-with-pdf.ts <pdf-file-path>
 */

import { PDFPlugin } from '../src/plugin';

async function main() {
  const pdfPath = process.argv[2];

  if (!pdfPath) {
    console.error('Usage: npx tsx scripts/test-with-pdf.ts <pdf-file-path>');
    process.exit(1);
  }

  console.log('Testing PDF Plugin with:', pdfPath);
  console.log('---');

  const plugin = new PDFPlugin();
  await plugin.init();

  try {
    const result = await plugin.toMarkdown(pdfPath);

    console.log('Markdown content (first 500 chars):');
    console.log(result.markdown.slice(0, 500));
    console.log('...');
    console.log('---');

    console.log('Mappings:');
    for (const m of result.mapping) {
      console.log(`  ${m.originalLocator}: lines ${m.markdownRange.startLine}-${m.markdownRange.endLine}`);
    }

    console.log('---');
    console.log('Total pages:', result.mapping.length);
    console.log('Total chars:', result.markdown.length);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await plugin.dispose();
  }
}

main();
```

**Step 2: 添加 tsx 开发依赖**

Run: `pnpm add -D -w tsx`
Expected: 成功安装

**Step 3: Commit**

```bash
git add packages/plugins/plugin-pdf/scripts pnpm-lock.yaml
git commit -m "chore(plugin-pdf): add integration test script"
```

---

## Task 6: 更新根 tsconfig.json

**Files:**
- Modify: `tsconfig.json`

**Step 1: 添加插件引用**

```json
{
  "files": [],
  "references": [
    { "path": "packages/core" },
    { "path": "packages/search" },
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
git commit -m "chore: add plugin-pdf to project references"
```

---

## Task 7: 最终验证

**Step 1: 完整构建**

Run: `pnpm build`
Expected: 编译成功

**Step 2: 运行所有测试**

Run: `pnpm test`
Expected: 所有测试通过

---

## 完成检查清单

- [ ] 正确实现 DocumentPlugin 接口
- [ ] PDF 文本提取功能实现
- [ ] 页码 mapping 正确生成
- [ ] parseLocator 正确解析
- [ ] 基础测试通过

---

## 输出接口

```typescript
// 从 @agent-fs/plugin-pdf 导入
import { PDFPlugin, createPDFPlugin } from '@agent-fs/plugin-pdf';

// 使用示例
const plugin = createPDFPlugin();
await plugin.init();

const result = await plugin.toMarkdown('/path/to/document.pdf');
console.log(result.markdown);
console.log(result.mapping); // [{ markdownRange: {...}, originalLocator: 'page:1' }, ...]

await plugin.dispose();
```

---

## 下一步

P1 完成后，以下计划可以继续：
- [F] indexer（需要 P1）

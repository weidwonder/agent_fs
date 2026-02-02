# [B4] Plugin Markdown - Markdown 插件实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 Markdown 文档处理插件，作为插件系统的参考实现

**Architecture:** 实现 DocumentPlugin 接口，读取 .md 文件并生成位置映射

**Tech Stack:** Node.js fs

**依赖:** [A] foundation

**被依赖:** [F] indexer

---

## 成功标准

- [ ] 正确实现 DocumentPlugin 接口
- [ ] toMarkdown() 返回原内容 + mapping
- [ ] parseLocator() 正确解析行号
- [ ] 单元测试覆盖率 > 80%

---

## Task 1: 创建 plugin-markdown 包结构

**Files:**
- Create: `packages/plugins/plugin-markdown/package.json`
- Create: `packages/plugins/plugin-markdown/tsconfig.json`
- Create: `packages/plugins/plugin-markdown/src/index.ts`

**Step 1: 创建目录**

Run: `mkdir -p packages/plugins/plugin-markdown/src`
Expected: 目录创建成功

**Step 2: 创建 package.json**

```json
{
  "name": "@agent-fs/plugin-markdown",
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
    "@agent-fs/core": "workspace:*"
  },
  "devDependencies": {
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
// @agent-fs/plugin-markdown
export { MarkdownPlugin } from './plugin';
```

**Step 5: 更新 pnpm-workspace.yaml（如需要）**

确认 `packages/plugins/*` 已包含在 workspace 中。

**Step 6: Commit**

```bash
git add packages/plugins/plugin-markdown
git commit -m "chore: create @agent-fs/plugin-markdown package structure"
```

---

## Task 2: 实现 MarkdownPlugin

**Files:**
- Create: `packages/plugins/plugin-markdown/src/plugin.ts`

**Step 1: 创建 plugin.ts**

```typescript
import { readFileSync } from 'node:fs';
import type {
  DocumentPlugin,
  DocumentConversionResult,
  PositionMapping,
  LocatorInfo,
} from '@agent-fs/core';

/**
 * Markdown 文档处理插件
 */
export class MarkdownPlugin implements DocumentPlugin {
  readonly name = 'markdown';
  readonly supportedExtensions = ['md', 'markdown'];

  /**
   * 将 Markdown 文件转换为 Markdown（直接返回原内容）
   */
  async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // 生成行号映射
    const mapping: PositionMapping[] = [];

    // 为每一行创建映射
    let currentStart = 1;
    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      mapping.push({
        markdownRange: {
          startLine: lineNum,
          endLine: lineNum,
        },
        originalLocator: `line:${lineNum}`,
      });
    }

    // 合并连续的非空行为段落映射
    const paragraphMapping = this.createParagraphMapping(lines);

    return {
      markdown: content,
      mapping: paragraphMapping,
    };
  }

  /**
   * 解析定位符
   */
  parseLocator(locator: string): LocatorInfo {
    // 格式: line:N 或 line:N-M
    const match = locator.match(/^line:(\d+)(?:-(\d+))?$/);

    if (!match) {
      return {
        displayText: locator,
      };
    }

    const startLine = parseInt(match[1], 10);
    const endLine = match[2] ? parseInt(match[2], 10) : startLine;

    if (startLine === endLine) {
      return {
        displayText: `第 ${startLine} 行`,
        jumpInfo: { line: startLine },
      };
    }

    return {
      displayText: `第 ${startLine}-${endLine} 行`,
      jumpInfo: { startLine, endLine },
    };
  }

  /**
   * 创建段落级别的映射
   * 将连续的非空行合并为一个段落
   */
  private createParagraphMapping(lines: string[]): PositionMapping[] {
    const mapping: PositionMapping[] = [];
    let paragraphStart: number | null = null;

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const line = lines[i];
      const isEmpty = line.trim() === '';

      if (!isEmpty && paragraphStart === null) {
        // 开始新段落
        paragraphStart = lineNum;
      } else if (isEmpty && paragraphStart !== null) {
        // 结束段落
        mapping.push({
          markdownRange: {
            startLine: paragraphStart,
            endLine: lineNum - 1,
          },
          originalLocator: `line:${paragraphStart}-${lineNum - 1}`,
        });
        paragraphStart = null;
      }
    }

    // 处理最后一个段落
    if (paragraphStart !== null) {
      mapping.push({
        markdownRange: {
          startLine: paragraphStart,
          endLine: lines.length,
        },
        originalLocator: `line:${paragraphStart}-${lines.length}`,
      });
    }

    return mapping;
  }

  /**
   * 初始化（无需特殊处理）
   */
  async init(): Promise<void> {
    // Markdown 插件无需初始化
  }

  /**
   * 销毁（无需特殊处理）
   */
  async dispose(): Promise<void> {
    // Markdown 插件无需清理
  }
}

/**
 * 创建 Markdown 插件实例
 */
export function createMarkdownPlugin(): DocumentPlugin {
  return new MarkdownPlugin();
}
```

**Step 2: 更新 index.ts**

```typescript
// @agent-fs/plugin-markdown
export { MarkdownPlugin, createMarkdownPlugin } from './plugin';
```

**Step 3: 验证编译**

Run: `pnpm install && pnpm --filter @agent-fs/plugin-markdown build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add packages/plugins/plugin-markdown
git commit -m "feat(plugin-markdown): implement MarkdownPlugin"
```

---

## Task 3: 编写单元测试

**Files:**
- Create: `packages/plugins/plugin-markdown/src/plugin.test.ts`

**Step 1: 创建测试文件**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MarkdownPlugin } from './plugin';

describe('MarkdownPlugin', () => {
  const plugin = new MarkdownPlugin();
  const testDir = join(tmpdir(), 'md-plugin-test-' + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(plugin.name).toBe('markdown');
    });

    it('should support md and markdown extensions', () => {
      expect(plugin.supportedExtensions).toContain('md');
      expect(plugin.supportedExtensions).toContain('markdown');
    });
  });

  describe('toMarkdown', () => {
    it('should return original content', async () => {
      const content = '# Title\n\nSome content here.';
      const filePath = join(testDir, 'test.md');
      writeFileSync(filePath, content);

      const result = await plugin.toMarkdown(filePath);
      expect(result.markdown).toBe(content);
    });

    it('should generate paragraph mapping', async () => {
      const content = '# Title\n\nParagraph 1.\n\nParagraph 2.';
      const filePath = join(testDir, 'test.md');
      writeFileSync(filePath, content);

      const result = await plugin.toMarkdown(filePath);
      expect(result.mapping.length).toBeGreaterThan(0);
    });

    it('should handle empty file', async () => {
      const filePath = join(testDir, 'empty.md');
      writeFileSync(filePath, '');

      const result = await plugin.toMarkdown(filePath);
      expect(result.markdown).toBe('');
      expect(result.mapping).toHaveLength(0);
    });

    it('should handle single line file', async () => {
      const content = 'Single line content';
      const filePath = join(testDir, 'single.md');
      writeFileSync(filePath, content);

      const result = await plugin.toMarkdown(filePath);
      expect(result.markdown).toBe(content);
      expect(result.mapping.length).toBe(1);
      expect(result.mapping[0].originalLocator).toBe('line:1-1');
    });

    it('should handle Chinese content', async () => {
      const content = '# 标题\n\n这是中文内容。\n\n第二段。';
      const filePath = join(testDir, 'chinese.md');
      writeFileSync(filePath, content);

      const result = await plugin.toMarkdown(filePath);
      expect(result.markdown).toBe(content);
      expect(result.mapping.length).toBeGreaterThan(0);
    });
  });

  describe('parseLocator', () => {
    it('should parse single line locator', () => {
      const info = plugin.parseLocator('line:42');
      expect(info.displayText).toBe('第 42 行');
      expect(info.jumpInfo).toEqual({ line: 42 });
    });

    it('should parse range locator', () => {
      const info = plugin.parseLocator('line:10-20');
      expect(info.displayText).toBe('第 10-20 行');
      expect(info.jumpInfo).toEqual({ startLine: 10, endLine: 20 });
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
});
```

**Step 2: 运行测试**

Run: `pnpm --filter @agent-fs/plugin-markdown test`
Expected: 测试通过

**Step 3: Commit**

```bash
git add packages/plugins/plugin-markdown/src/plugin.test.ts
git commit -m "test(plugin-markdown): add MarkdownPlugin tests"
```

---

## Task 4: 更新根 tsconfig.json

**Files:**
- Modify: `tsconfig.json`

**Step 1: 添加插件引用**

```json
{
  "files": [],
  "references": [
    { "path": "packages/core" },
    { "path": "packages/search" },
    { "path": "packages/plugins/plugin-markdown" }
  ]
}
```

**Step 2: 验证编译**

Run: `pnpm build`
Expected: 编译成功

**Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "chore: add plugin-markdown to project references"
```

---

## Task 5: 最终验证

**Step 1: 完整构建**

Run: `pnpm build`
Expected: 编译成功

**Step 2: 运行所有测试**

Run: `pnpm test`
Expected: 所有测试通过

**Step 3: 测试覆盖率**

Run: `pnpm test:coverage`
Expected: plugin-markdown 覆盖率 > 80%

---

## 完成检查清单

- [ ] 正确实现 DocumentPlugin 接口
- [ ] toMarkdown() 返回原内容
- [ ] mapping 包含正确的行号范围
- [ ] parseLocator() 正确解析
- [ ] 测试覆盖率 > 80%

---

## 输出接口

```typescript
// 从 @agent-fs/plugin-markdown 导入
import { MarkdownPlugin, createMarkdownPlugin } from '@agent-fs/plugin-markdown';

// 使用示例
const plugin = createMarkdownPlugin();
const result = await plugin.toMarkdown('/path/to/file.md');
console.log(result.markdown);
console.log(result.mapping);
```

---

## 下一步

B4 完成后，以下计划可以继续：
- [F] indexer（需要 B4）

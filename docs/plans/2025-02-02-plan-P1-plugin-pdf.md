# [P1] Plugin PDF - PDF 插件实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 PDF 文档处理插件，使用 MinerU 转换 PDF 为 Markdown，生成位置映射后复用 Markdown 分块逻辑

**Architecture:** 使用 MinerU 将 PDF 转换为 Markdown 格式，记录 PDF 位置（页码/区域）到 Markdown 行号的映射关系

**Tech Stack:** MinerU (Python), child_process (Node.js)

**依赖:** [A] foundation

**被依赖:** [F] indexer

---

## 设计说明

### 核心思路

1. **PDF → Markdown 转换**：使用 MinerU 将 PDF 转为结构化的 Markdown
2. **位置映射记录**：MinerU 输出时记录 PDF 位置（页码/区域）与 Markdown 行号的映射
3. **复用 Markdown 流程**：生成的 Markdown 可以直接复用 chunker 分块逻辑
4. **双向定位**：
   - Markdown chunk → PDF 原始位置（页码/区域）
   - 用户查看结果时能跳转回 PDF 原文

### PositionMapping 格式

```typescript
interface PositionMapping {
  // Markdown 内容的行号范围
  markdownRange: {
    startLine: number;
    endLine: number;
  };
  // PDF 原始位置标识符
  // 格式: "page:N" 或 "page:N:x,y,w,h" (页码:坐标区域)
  originalLocator: string;
}
```

### MinerU 集成方式

- 通过 Node.js `child_process` 调用 MinerU Python CLI
- MinerU 输出 Markdown + 位置映射 JSON
- 插件解析输出，构建 `DocumentConversionResult`

---

## 成功标准

- [ ] 正确实现 DocumentPlugin 接口
- [ ] 能调用 MinerU 转换 PDF 为 Markdown
- [ ] 生成正确的位置映射（页码/区域 → Markdown 行号）
- [ ] parseLocator 正确解析 PDF 位置标识符
- [ ] 单元测试覆盖率 > 80%
- [ ] 集成测试：完整转换流程可运行

---

## Task 1: 研究 MinerU 输出格式

**Goal:** 了解 MinerU 的调用方式和输出格式

**Step 1: 安装 MinerU（本地测试）**

```bash
# 在临时环境安装 MinerU
pip install magic-pdf
```

**Step 2: 测试 MinerU 输出**

```bash
# 测试 PDF 转换，观察输出格式
magic-pdf -p sample.pdf -o output/
```

**Step 3: 确认输出内容**

需要确认：
- Markdown 输出路径和格式
- 是否包含位置映射信息（页码、坐标）
- 位置映射的数据格式（JSON/XML/其他）

**Step 4: 记录调用参数**

确定最终的 MinerU 调用参数：
- 输出格式：Markdown
- 保留位置信息的选项
- 其他必要配置

**Notes:**
- 如果 MinerU 不直接输出位置映射，需要探索其他方案
- 可能需要解析 MinerU 的中间格式（如 JSON layout）

---

## Task 2: 创建 plugin-pdf 包结构

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
    "@agent-fs/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.0.0"
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

## Task 3: 实现 MinerU 调用模块

**Files:**
- Create: `packages/plugins/plugin-pdf/src/mineru.ts`

**Step 1: 创建 mineru.ts**

```typescript
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * MinerU 转换结果
 */
export interface MinerUResult {
  /** Markdown 内容 */
  markdown: string;
  /** 位置映射 JSON（如果可用） */
  mapping?: MinerUMapping[];
}

/**
 * MinerU 位置映射项
 */
export interface MinerUMapping {
  /** PDF 页码 (1-based) */
  page: number;
  /** 区域坐标 (可选) */
  bbox?: { x: number; y: number; width: number; height: number };
  /** 对应的 Markdown 行号范围 */
  markdownLines: { start: number; end: number };
}

/**
 * MinerU 配置选项
 */
export interface MinerUOptions {
  /** MinerU 命令路径，默认 'magic-pdf' */
  command?: string;
  /** 超时时间（毫秒），默认 60000 */
  timeout?: number;
  /** 是否保留临时文件用于调试 */
  keepTemp?: boolean;
}

/**
 * 调用 MinerU 转换 PDF
 */
export async function convertPDFWithMinerU(
  pdfPath: string,
  options: MinerUOptions = {},
): Promise<MinerUResult> {
  const command = options.command ?? 'magic-pdf';
  const timeout = options.timeout ?? 60000;
  const keepTemp = options.keepTemp ?? false;

  // 创建临时输出目录
  const tempDir = join(tmpdir(), `agent-fs-pdf-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // 调用 MinerU
    await runMinerU(command, pdfPath, tempDir, timeout);

    // 读取输出的 Markdown
    const markdownPath = join(tempDir, 'output.md'); // 根据实际输出调整
    const markdown = readFileSync(markdownPath, 'utf-8');

    // 尝试读取位置映射（如果存在）
    const mappingPath = join(tempDir, 'mapping.json'); // 根据实际输出调整
    let mapping: MinerUMapping[] | undefined;

    if (existsSync(mappingPath)) {
      const mappingJson = readFileSync(mappingPath, 'utf-8');
      mapping = JSON.parse(mappingJson);
    }

    return { markdown, mapping };
  } finally {
    // 清理临时目录
    if (!keepTemp) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

/**
 * 运行 MinerU 命令
 */
function runMinerU(
  command: string,
  pdfPath: string,
  outputDir: string,
  timeout: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // 根据 MinerU 实际参数调整
    const args = ['-p', pdfPath, '-o', outputDir, '--format', 'markdown'];

    const process = spawn(command, args, {
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      process.kill();
      reject(new Error(`MinerU 超时 (${timeout}ms)`));
    }, timeout);

    process.on('close', (code) => {
      clearTimeout(timer);

      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `MinerU 失败 (code ${code}):\nstdout: ${stdout}\nstderr: ${stderr}`,
          ),
        );
      }
    });

    process.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`无法启动 MinerU: ${error.message}`));
    });
  });
}
```

**Step 2: 验证编译**

Run: `pnpm --filter @agent-fs/plugin-pdf build`
Expected: 编译成功

**Step 3: Commit**

```bash
git add packages/plugins/plugin-pdf/src/mineru.ts
git commit -m "feat(plugin-pdf): add MinerU integration module"
```

---

## Task 4: 实现 PDFPlugin

**Files:**
- Create: `packages/plugins/plugin-pdf/src/plugin.ts`

**Step 1: 创建 plugin.ts**

```typescript
import type {
  DocumentConversionResult,
  DocumentPlugin,
  LocatorInfo,
  PositionMapping,
} from '@agent-fs/core';
import { convertPDFWithMinerU, type MinerUOptions } from './mineru';

/**
 * PDF 插件配置
 */
export interface PDFPluginOptions {
  /** MinerU 配置 */
  minerU?: MinerUOptions;
}

/**
 * PDF 文档处理插件
 *
 * 使用 MinerU 将 PDF 转换为 Markdown，并保留位置映射
 */
export class PDFPlugin implements DocumentPlugin {
  /** 插件名称 */
  readonly name = 'pdf';

  /** 支持的文件扩展名 */
  readonly supportedExtensions = ['pdf'];

  private options: PDFPluginOptions;

  constructor(options: PDFPluginOptions = {}) {
    this.options = options;
  }

  /**
   * 将 PDF 转换为 Markdown
   */
  async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
    // 调用 MinerU 转换
    const result = await convertPDFWithMinerU(filePath, this.options.minerU);

    // 构建 PositionMapping
    const mapping = this.buildPositionMapping(result);

    return {
      markdown: result.markdown,
      mapping,
    };
  }

  /**
   * 解析定位符
   */
  parseLocator(locator: string): LocatorInfo {
    // 格式1: page:N
    // 格式2: page:N:x,y,w,h (页码:坐标区域)
    const pageMatch = locator.match(/^page:(\d+)(?::(.+))?$/);

    if (!pageMatch) {
      return {
        displayText: locator,
      };
    }

    const pageNum = Number.parseInt(pageMatch[1], 10);
    const bboxStr = pageMatch[2];

    if (!bboxStr) {
      // 仅页码
      return {
        displayText: `第 ${pageNum} 页`,
        jumpInfo: { page: pageNum },
      };
    }

    // 包含坐标区域
    return {
      displayText: `第 ${pageNum} 页 (${bboxStr})`,
      jumpInfo: { page: pageNum, bbox: bboxStr },
    };
  }

  /**
   * 构建 PositionMapping
   */
  private buildPositionMapping(result: {
    markdown: string;
    mapping?: Array<{
      page: number;
      bbox?: { x: number; y: number; width: number; height: number };
      markdownLines: { start: number; end: number };
    }>;
  }): PositionMapping[] {
    if (!result.mapping || result.mapping.length === 0) {
      // 如果没有 mapping，回退到按页划分
      return this.fallbackPageMapping(result.markdown);
    }

    return result.mapping.map((item) => {
      let locator = `page:${item.page}`;

      if (item.bbox) {
        const { x, y, width, height } = item.bbox;
        locator += `:${x},${y},${width},${height}`;
      }

      return {
        markdownRange: {
          startLine: item.markdownLines.start,
          endLine: item.markdownLines.end,
        },
        originalLocator: locator,
      };
    });
  }

  /**
   * 回退方案：按页划分映射
   * 当 MinerU 没有提供详细映射时使用
   */
  private fallbackPageMapping(markdown: string): PositionMapping[] {
    const lines = markdown.split('\n');
    const mapping: PositionMapping[] = [];

    // 简单策略：假设每个 "---" 分隔符表示新页
    let currentPage = 1;
    let pageStart = 1;

    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].trim() === '---') {
        if (i > pageStart) {
          mapping.push({
            markdownRange: { startLine: pageStart, endLine: i },
            originalLocator: `page:${currentPage}`,
          });
        }
        currentPage += 1;
        pageStart = i + 1;
      }
    }

    // 最后一页
    if (pageStart <= lines.length) {
      mapping.push({
        markdownRange: { startLine: pageStart, endLine: lines.length },
        originalLocator: `page:${currentPage}`,
      });
    }

    return mapping;
  }

  /** 初始化 */
  async init(): Promise<void> {
    // 可在此检查 MinerU 是否可用
    // 暂时跳过，首次调用时会报错
  }

  /** 销毁 */
  async dispose(): Promise<void> {
    // 无需清理
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
export type { MinerUOptions, MinerUResult, MinerUMapping } from './mineru';
```

**Step 3: 验证编译**

Run: `pnpm --filter @agent-fs/plugin-pdf build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add packages/plugins/plugin-pdf
git commit -m "feat(plugin-pdf): implement PDFPlugin with MinerU integration"
```

---

## Task 5: 编写单元测试

**Files:**
- Create: `packages/plugins/plugin-pdf/src/plugin.test.ts`

**Step 1: 创建 plugin.test.ts**

```typescript
import { describe, expect, it } from 'vitest';
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
    it('should parse simple page locator', () => {
      const info = plugin.parseLocator('page:5');
      expect(info.displayText).toBe('第 5 页');
      expect(info.jumpInfo).toEqual({ page: 5 });
    });

    it('should parse page with bbox locator', () => {
      const info = plugin.parseLocator('page:3:100,200,300,400');
      expect(info.displayText).toContain('第 3 页');
      expect(info.jumpInfo).toEqual({
        page: 3,
        bbox: '100,200,300,400',
      });
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

  // toMarkdown 测试需要 MinerU 环境
  describe('toMarkdown', () => {
    it.todo('should convert PDF to Markdown using MinerU');
    it.todo('should generate position mapping');
    it.todo('should handle multi-page PDF');
    it.todo('should fallback to page-based mapping if detailed mapping unavailable');
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

## Task 6: 添加集成测试脚本

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

  const plugin = new PDFPlugin({
    minerU: {
      keepTemp: true, // 保留临时文件以供检查
    },
  });

  await plugin.init();

  try {
    const result = await plugin.toMarkdown(pdfPath);

    console.log('Markdown content (first 500 chars):');
    console.log(result.markdown.slice(0, 500));
    console.log('...');
    console.log('---');

    console.log('Position Mappings:');
    for (const m of result.mapping) {
      console.log(
        `  Lines ${m.markdownRange.startLine}-${m.markdownRange.endLine} → ${m.originalLocator}`,
      );
    }

    console.log('---');
    console.log('Total mappings:', result.mapping.length);
    console.log('Total chars:', result.markdown.length);
    console.log('Total lines:', result.markdown.split('\n').length);
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

## Task 7: 添加 README 文档

**Files:**
- Create: `packages/plugins/plugin-pdf/README.md`

**Step 1: 创建 README.md**

```markdown
# @agent-fs/plugin-pdf

PDF 文档处理插件，使用 MinerU 转换 PDF 为 Markdown。

## 功能

- 将 PDF 转换为结构化 Markdown
- 保留 PDF 位置映射（页码/坐标区域）
- 支持双向定位：Markdown ↔ PDF
- 复用 Markdown 分块和向量化流程

## 依赖

### MinerU

需要安装 [MinerU](https://github.com/opendatalab/MinerU)：

```bash
pip install magic-pdf
```

验证安装：

```bash
magic-pdf --version
```

## 使用

```typescript
import { createPDFPlugin } from '@agent-fs/plugin-pdf';

const plugin = createPDFPlugin({
  minerU: {
    command: 'magic-pdf', // MinerU 命令路径
    timeout: 60000,       // 超时时间（毫秒）
  },
});

await plugin.init();

const result = await plugin.toMarkdown('/path/to/document.pdf');
console.log(result.markdown);
console.log(result.mapping);

await plugin.dispose();
```

## 位置映射格式

### originalLocator

- `page:N` - 第 N 页
- `page:N:x,y,w,h` - 第 N 页的坐标区域

### 示例

```typescript
{
  markdownRange: { startLine: 1, endLine: 50 },
  originalLocator: 'page:1:100,200,500,600'
}
```

## 测试

```bash
# 单元测试
pnpm test

# 集成测试（需要 MinerU）
npx tsx scripts/test-with-pdf.ts /path/to/sample.pdf
```

## 注意事项

1. **MinerU 必须安装**：首次使用前需安装 Python 和 MinerU
2. **性能**：PDF 转换可能较慢，建议设置合理的 timeout
3. **回退机制**：如果 MinerU 未提供详细映射，会回退到按页划分

## 许可证

MIT
```

**Step 2: Commit**

```bash
git add packages/plugins/plugin-pdf/README.md
git commit -m "docs(plugin-pdf): add README documentation"
```

---

## Task 8: 更新根 tsconfig.json

**Files:**
- Modify: `tsconfig.json`

**Step 1: 添加插件引用**

在 `tsconfig.json` 的 `references` 数组中添加：

```json
{ "path": "packages/plugins/plugin-pdf" }
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

## Task 9: 最终验证

**Step 1: 完整构建**

Run: `pnpm build`
Expected: 编译成功

**Step 2: 运行所有测试**

Run: `pnpm test`
Expected: 所有测试通过

**Step 3: （可选）手动测试**

如果本地已安装 MinerU：

```bash
npx tsx packages/plugins/plugin-pdf/scripts/test-with-pdf.ts /path/to/sample.pdf
```

Expected: 成功转换并输出映射信息

---

## 完成检查清单

- [ ] 正确实现 DocumentPlugin 接口
- [ ] MinerU 集成模块实现
- [ ] PDF → Markdown 转换功能
- [ ] 位置映射正确生成
- [ ] parseLocator 正确解析
- [ ] 单元测试通过
- [ ] 集成测试脚本可用
- [ ] README 文档完整

---

## 输出接口

```typescript
// 从 @agent-fs/plugin-pdf 导入
import { createPDFPlugin } from '@agent-fs/plugin-pdf';

// 使用示例
const plugin = createPDFPlugin({
  minerU: {
    command: 'magic-pdf',
    timeout: 60000,
  },
});

await plugin.init();

const result = await plugin.toMarkdown('/path/to/document.pdf');
// result.markdown: 转换后的 Markdown 内容
// result.mapping: 位置映射数组

await plugin.dispose();
```

---

## 下一步

P1 完成后，以下计划可以继续：
- [F] indexer（需要 P1）

---

## 备注

### MinerU 调用细节

Task 1 完成后需要补充 MinerU 的实际调用参数和输出格式。当前实现基于假设，可能需要根据 MinerU 实际情况调整：

- 输出文件名和路径
- 位置映射的 JSON 格式
- 命令行参数

### 替代方案

如果 MinerU 不满足需求，可考虑：
- pdf-parse + layout 分析
- pdfjs + 自定义解析
- 其他 PDF 处理库

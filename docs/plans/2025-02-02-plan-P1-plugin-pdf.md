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

## Task 1: MinerU 输出格式说明

**已确认的 MinerU 工作方式：**

### HTTP API 调用

```typescript
// 端点
POST ${apiHost}/file_parse

// 请求参数 (FormData)
{
  return_md: 'true',
  response_format_zip: 'true',
  files: [文件 Buffer]
}

// 请求头
{
  token: userId,
  Authorization: 'Bearer ...' (可选)
}

// 响应
返回 ZIP 文件 (application/zip)
```

### 输出文件结构

```
<file_id>/
├── vlm/
│   ├── images/                        # 提取的图片
│   ├── xxx_content_list_v2.json       # ⭐️ 按页组织的内容（含位置）
│   ├── xxx_content_list.json          # 旧版内容列表
│   ├── xxx.md                         # ⭐️ 生成的 Markdown
│   ├── xxx_layout.pdf                 # 带布局标注的 PDF
│   ├── xxx_middle.json                # 中间数据
│   ├── xxx_model.json                 # 模型数据
│   └── xxx_origin.pdf                 # 原始 PDF
```

### content_list_v2.json 结构

```json
[
  [  // 第 1 页
    {
      "type": "title" | "paragraph" | "table" | "image",
      "content": {
        "title_content": [{ "type": "text", "content": "..." }],
        "level": 1
      },
      "bbox": [x, y, width, height]
    }
  ],
  [  // 第 2 页
    ...
  ]
]
```

### 位置映射策略

1. 解析 `content_list_v2.json`（按页组织，包含 bbox）
2. 提取每页的所有文本内容
3. 在 Markdown 中匹配文本，确定每页对应的行号范围
4. 生成 PositionMapping（页级粒度）

**格式：**
- `originalLocator`: `page:N`（从 1 开始）
- `markdownRange`: `{ startLine, endLine }`

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
    "@agent-fs/core": "workspace:*",
    "undici": "^6.0.0",
    "adm-zip": "^0.5.10"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.0.0",
    "@types/adm-zip": "^0.5.5"
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

## Task 3: 实现 MinerU HTTP 调用模块

**Files:**
- Create: `packages/plugins/plugin-pdf/src/mineru.ts`

**Step 1: 创建 mineru.ts**

```typescript
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';

/**
 * MinerU 转换结果
 */
export interface MinerUResult {
  /** Markdown 内容 */
  markdown: string;
  /** content_list_v2.json 内容（按页组织的内容块） */
  contentList?: MinerUContentList;
}

/**
 * MinerU 内容块（content_list_v2.json 中的元素）
 */
export interface MinerUBlock {
  type: 'title' | 'paragraph' | 'table' | 'image';
  content: {
    title_content?: Array<{ type: string; content: string }>;
    paragraph_content?: Array<{ type: string; content: string }>;
    level?: number;
  };
  bbox: [number, number, number, number]; // [x, y, width, height]
}

/**
 * MinerU 页面数组类型
 * content_list_v2.json 是一个二维数组: Array<Array<MinerUBlock>>
 */
export type MinerUContentList = MinerUBlock[][];

/**
 * MinerU 配置选项
 */
export interface MinerUOptions {
  /** MinerU API 地址 */
  apiHost: string;
  /** 超时时间（毫秒），默认 120000 */
  timeout?: number;
  /** 是否保留临时文件用于调试 */
  keepTemp?: boolean;
  /** 用户 ID（用于 token 头） */
  userId?: string;
  /** API Key（可选） */
  apiKey?: string;
}

/**
 * 调用 MinerU HTTP API 转换 PDF
 */
export async function convertPDFWithMinerU(
  pdfPath: string,
  options: MinerUOptions,
): Promise<MinerUResult> {
  const timeout = options.timeout ?? 120000;
  const keepTemp = options.keepTemp ?? false;

  // 创建临时目录
  const tempDir = join(tmpdir(), `agent-fs-pdf-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  let zipPath: string | undefined;

  try {
    // 1. 调用 MinerU API
    zipPath = await uploadFileAndDownloadZip(pdfPath, tempDir, options, timeout);

    // 2. 解压 ZIP
    const extractDir = join(tempDir, 'extracted');
    mkdirSync(extractDir, { recursive: true });

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);

    // 3. 查找输出文件
    const { markdownPath, contentListPath } = findOutputFiles(extractDir);

    // 4. 读取文件
    const markdown = readFileSync(markdownPath, 'utf-8');
    let contentList: MinerUContentList | undefined;

    if (contentListPath && existsSync(contentListPath)) {
      const contentListJson = readFileSync(contentListPath, 'utf-8');
      contentList = JSON.parse(contentListJson) as MinerUContentList;
    }

    return { markdown, contentList };
  } finally {
    // 清理临时文件
    if (!keepTemp) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

/**
 * 上传文件到 MinerU 并下载 ZIP
 */
async function uploadFileAndDownloadZip(
  pdfPath: string,
  tempDir: string,
  options: MinerUOptions,
  timeout: number,
): Promise<string> {
  const endpoint = `${options.apiHost}/file_parse`;
  const fileBuffer = readFileSync(pdfPath);

  // 构建 FormData（使用 undici 的 FormData 以确保兼容性）
  const { FormData } = await import('undici');
  const formData = new FormData();
  formData.append('return_md', 'true');
  formData.append('response_format_zip', 'true');

  // 创建 Blob 并添加到 FormData
  const blob = new Blob([fileBuffer], { type: 'application/pdf' });
  formData.append('files', blob, pdfPath.split('/').pop() || 'document.pdf');

  // 发起请求
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        token: options.userId ?? '',
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
        // FormData 会自动设置正确的 content-type 和 boundary
      },
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // 检查响应类型（宽松匹配，允许 charset 等参数）
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/zip')) {
      throw new Error(`Unexpected content-type: ${contentType}`);
    }

    // 保存 ZIP
    const zipPath = join(tempDir, 'result.zip');
    const arrayBuffer = await response.arrayBuffer();
    writeFileSync(zipPath, Buffer.from(arrayBuffer));

    return zipPath;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 查找解压后的输出文件
 */
function findOutputFiles(extractDir: string): {
  markdownPath: string;
  contentListPath?: string;
} {
  // 查找 vlm 子目录
  const vlmDir = join(extractDir, 'vlm');
  if (!existsSync(vlmDir)) {
    throw new Error('vlm directory not found in extracted files');
  }

  // 读取目录内容
  const files = readdirSync(vlmDir);
  const mdFile = files.find((f: string) => f.endsWith('.md'));

  if (!mdFile) {
    throw new Error('.md file not found in vlm directory');
  }

  const markdownPath = join(vlmDir, mdFile);

  // 查找 content_list_v2.json
  const contentListFile = files.find((f: string) =>
    f.endsWith('_content_list_v2.json'),
  );
  const contentListPath = contentListFile
    ? join(vlmDir, contentListFile)
    : undefined;

  return { markdownPath, contentListPath };
}
```

**Step 2: 安装依赖**

```bash
# 添加运行时依赖
pnpm add --filter @agent-fs/plugin-pdf undici adm-zip

# 添加类型定义
pnpm add -D --filter @agent-fs/plugin-pdf @types/adm-zip
```

**Step 3: 验证编译**

Run: `pnpm --filter @agent-fs/plugin-pdf build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add packages/plugins/plugin-pdf
git commit -m "feat(plugin-pdf): add MinerU HTTP API integration module"
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
import {
  convertPDFWithMinerU,
  type MinerUOptions,
  type MinerUContentList,
  type MinerUBlock,
} from './mineru';

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
   * 从 MinerU 的 content_list_v2.json 构建页级映射
   */
  private buildPositionMapping(result: {
    markdown: string;
    contentList?: MinerUContentList;
  }): PositionMapping[] {
    if (!result.contentList || result.contentList.length === 0) {
      // 如果没有 contentList，回退到简单策略
      return this.fallbackPageMapping(result.markdown);
    }

    const markdownLines = result.markdown.split('\n');
    const mapping: PositionMapping[] = [];

    let currentLine = 1;

    // 遍历每一页
    for (let pageIdx = 0; pageIdx < result.contentList.length; pageIdx += 1) {
      const page = result.contentList[pageIdx];
      const pageNumber = pageIdx + 1;

      // 提取该页的所有文本内容
      const pageTexts = this.extractPageTexts(page);

      // 在 Markdown 中查找该页的起始和结束行
      const pageRange = this.findPageRangeInMarkdown(
        markdownLines,
        pageTexts,
        currentLine,
      );

      if (pageRange) {
        mapping.push({
          markdownRange: {
            startLine: pageRange.startLine,
            endLine: pageRange.endLine,
          },
          originalLocator: `page:${pageNumber}`,
        });
        currentLine = pageRange.endLine + 1;
      }
    }

    return mapping;
  }

  /**
   * 提取页面的所有文本内容
   */
  private extractPageTexts(page: MinerUBlock[]): string[] {
    const texts: string[] = [];

    for (const block of page) {
      if (block.content.title_content) {
        for (const item of block.content.title_content) {
          if (item.content) {
            texts.push(item.content.trim());
          }
        }
      }
      if (block.content.paragraph_content) {
        for (const item of block.content.paragraph_content) {
          if (item.content) {
            texts.push(item.content.trim());
          }
        }
      }
    }

    return texts.filter((t) => t.length > 0);
  }

  /**
   * 在 Markdown 中查找页面的行号范围
   */
  private findPageRangeInMarkdown(
    markdownLines: string[],
    pageTexts: string[],
    startLine: number,
  ): { startLine: number; endLine: number } | null {
    if (pageTexts.length === 0) return null;

    // 查找该页第一个文本在 Markdown 中的位置
    const firstText = pageTexts[0];
    let foundStart = -1;

    for (let i = startLine - 1; i < markdownLines.length; i += 1) {
      if (markdownLines[i].includes(firstText)) {
        foundStart = i + 1;
        break;
      }
    }

    if (foundStart === -1) return null;

    // 查找该页最后一个文本在 Markdown 中的位置
    const lastText = pageTexts[pageTexts.length - 1];
    let foundEnd = foundStart;

    for (let i = foundStart - 1; i < markdownLines.length; i += 1) {
      if (markdownLines[i].includes(lastText)) {
        foundEnd = i + 1;
        break;
      }
    }

    return { startLine: foundStart, endLine: foundEnd };
  }

  /**
   * 回退方案：简单平均分配
   * 当 MinerU 没有提供 contentList 时使用
   */
  private fallbackPageMapping(markdown: string): PositionMapping[] {
    const lines = markdown.split('\n');
    const totalLines = lines.length;

    // 假设平均每页 20 行（简单估算）
    const estimatedPages = Math.ceil(totalLines / 20);
    const linesPerPage = Math.ceil(totalLines / estimatedPages);

    const mapping: PositionMapping[] = [];

    for (let page = 1; page <= estimatedPages; page += 1) {
      const startLine = (page - 1) * linesPerPage + 1;
      const endLine = Math.min(page * linesPerPage, totalLines);

      mapping.push({
        markdownRange: { startLine, endLine },
        originalLocator: `page:${page}`,
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
export type {
  MinerUOptions,
  MinerUResult,
  MinerUBlock,
  MinerUContentList,
} from './mineru';
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

PDF 文档处理插件，使用 MinerU HTTP API 转换 PDF 为 Markdown。

## 功能

- 将 PDF 转换为结构化 Markdown
- 保留 PDF 位置映射（页级粒度）
- 支持双向定位：Markdown ↔ PDF
- 复用 Markdown 分块和向量化流程

## 依赖

### MinerU HTTP 服务

需要部署 [MinerU](https://github.com/opendatalab/MinerU) HTTP 服务。

参考部署方式：
```bash
# 命令行方式（测试用）
mineru -b vlm-http-client -u http://your-api-host:port -p input.pdf -o output/

# 或使用 Docker 部署 HTTP 服务
# 详见 MinerU 文档
```

## 使用

```typescript
import { createPDFPlugin } from '@agent-fs/plugin-pdf';

const plugin = createPDFPlugin({
  minerU: {
    apiHost: 'http://10.144.0.99:30000',  // MinerU HTTP API 地址
    timeout: 120000,                       // 超时时间（毫秒）
    userId: 'user-123',                    // 可选：用户 ID
    apiKey: 'sk-...',                      // 可选：API Key
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

当前版本只支持页级映射：
- `page:N` - 第 N 页

### 示例

```typescript
{
  markdownRange: { startLine: 1, endLine: 50 },
  originalLocator: 'page:1'
}
```

## 测试

```bash
# 单元测试
pnpm test

# 集成测试（需要 MinerU HTTP 服务）
npx tsx scripts/test-with-pdf.ts /path/to/sample.pdf
```

## 注意事项

1. **MinerU HTTP 服务**：需要提前部署 MinerU HTTP API 服务
2. **性能**：PDF 转换较慢（大文件可能需要 1-2 分钟），建议设置 120s+ 超时
3. **位置映射**：当前只支持页级映射，不支持更精确的 bbox 映射
4. **回退机制**：如果无法解析 content_list_v2.json，会回退到简单平均分配策略

## 输出文件

MinerU 会生成以下文件（解压后）：
- `xxx.md` - Markdown 文件
- `xxx_content_list_v2.json` - 内容列表（含位置信息）
- `images/` - 提取的图片

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

- [x] 正确实现 DocumentPlugin 接口
- [x] MinerU 集成模块实现
- [x] PDF → Markdown 转换功能
- [x] 位置映射正确生成
- [x] parseLocator 正确解析
- [x] 单元测试通过
- [x] 集成测试脚本可用
- [x] README 文档完整

---

## 输出接口

```typescript
// 从 @agent-fs/plugin-pdf 导入
import { createPDFPlugin } from '@agent-fs/plugin-pdf';

// 使用示例
const plugin = createPDFPlugin({
  minerU: {
    apiHost: 'http://10.144.0.99:30000',  // MinerU HTTP API 地址
    timeout: 120000,                       // 超时时间（毫秒）
    userId: 'user-123',                    // 可选：用户 ID
    apiKey: 'sk-...',                      // 可选：API Key
  },
});

await plugin.init();

const result = await plugin.toMarkdown('/path/to/document.pdf');
// result.markdown: 转换后的 Markdown 内容
// result.mapping: 位置映射数组（页级粒度）
// 示例: [{ markdownRange: { startLine: 1, endLine: 50 }, originalLocator: 'page:1' }]

await plugin.dispose();
```

---

## 下一步

P1 完成后，以下计划可以继续：
- [F] indexer（需要 P1）

---

## 备注

### MinerU 调用细节（已确认）

**HTTP API：**
- 端点：`POST ${apiHost}/file_parse`
- 请求：FormData（`return_md: true`, `response_format_zip: true`, files）
- 响应：ZIP 文件（同步返回）

**输出文件：**
- `vlm/xxx.md` - Markdown 文件
- `vlm/xxx_content_list_v2.json` - 按页组织的内容块（含 bbox）
- `vlm/images/` - 提取的图片

**位置映射：**
- 解析 content_list_v2.json 获取每页的内容块
- 通过文本匹配在 Markdown 中定位每页的行号范围
- 生成页级映射（`page:N` 格式）

**参考实现：**
- cherry-studio: `OpenMineruPreprocessProvider.ts`
- 示例输出：`/Users/weidwonder/tasks/20260130 政旦待分析pdf/output/...`

### 已知限制

1. **位置映射粒度**：当前只支持页级映射，不支持块级（bbox）映射
2. **文本匹配**：依赖简单的文本包含匹配，可能不够精确
3. **超时时间**：大文件处理时间较长，建议设置 120s+ 超时

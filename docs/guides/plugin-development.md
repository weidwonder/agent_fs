# 插件开发指南

> 如何为 Agent FS 创建自定义文档处理插件

## 目录

- [快速开始](#快速开始)
- [核心概念](#核心概念)
- [插件接口](#插件接口)
- [实现步骤](#实现步骤)
- [定位符设计](#定位符设计)
- [位置映射](#位置映射)
- [测试要求](#测试要求)
- [最佳实践](#最佳实践)
- [常见问题](#常见问题)

## 快速开始

### 插件的作用

插件负责将特定格式的文档（如 PDF、DOCX、XLSX）转换为 Markdown，并建立原文档与转换后内容的位置映射关系。所有插件的输出都经过统一的切分、摘要生成和向量化流程。

### 最小化示例

```typescript
import { DocumentPlugin, DocumentConversionResult, LocatorInfo } from '@agent-fs/core';
import { readFileSync } from 'fs';

export class TxtPlugin implements DocumentPlugin {
  readonly name = 'txt';
  readonly supportedExtensions = ['txt'];

  async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // 为每 10 行创建一个映射
    const mapping = lines.reduce((acc, _, index) => {
      if (index % 10 === 0) {
        acc.push({
          markdownRange: {
            startLine: index + 1,
            endLine: Math.min(index + 10, lines.length)
          },
          originalLocator: `line:${index + 1}-${Math.min(index + 10, lines.length)}`
        });
      }
      return acc;
    }, []);

    return { markdown: content, mapping };
  }

  parseLocator(locator: string): LocatorInfo {
    const match = locator.match(/^line:(\d+)(?:-(\d+))?$/);
    if (!match) return { displayText: locator };

    const start = parseInt(match[1]);
    const end = match[2] ? parseInt(match[2]) : start;

    return {
      displayText: end === start ? `第 ${start} 行` : `第 ${start}-${end} 行`,
      jumpInfo: { line: start }
    };
  }
}
```

## 核心概念

### 1. 文档处理流程

```
原始文档 (PDF/DOCX/XLSX/...)
    ↓
[插件] toMarkdown()
    ↓
Markdown + PositionMapping[]
    ↓
[Chunker] 切分为 chunks
    ↓
[LLM] 生成摘要 + [Embedding] 向量化
    ↓
[Storage] 存储到向量数据库和全文索引
```

### 2. 关键组件

| 组件 | 职责 |
|------|------|
| **DocumentPlugin** | 将文档转换为 Markdown + 位置映射 |
| **PositionMapping** | 记录 Markdown 行号 ↔ 原文位置的对应关系 |
| **Locator** | 插件自定义的原文位置标识符（如 `page:5` 或 `line:42`） |
| **MarkdownChunker** | 按结构切分 Markdown（标题、段落等） |
| **PluginManager** | 管理和调度所有插件 |

### 3. 为什么转换为 Markdown？

- **统一处理**：所有文档类型复用同一套切分和向量化逻辑
- **结构保留**：Markdown 保留了标题层级、列表、表格等结构
- **易于解析**：成熟的 AST 解析库（如 remark）
- **全文友好**：纯文本格式便于全文搜索和 BM25 索引

## 插件接口

### DocumentPlugin 接口定义

```typescript
/**
 * 文档处理插件接口
 */
interface DocumentPlugin {
  /** 插件名称（唯一标识） */
  name: string;

  /** 支持的文件扩展名列表（不含点号） */
  supportedExtensions: string[];

  /** 将文档转换为 Markdown（核心方法） */
  toMarkdown(filePath: string): Promise<DocumentConversionResult>;

  /** 解析定位符为可读信息（可选） */
  parseLocator?(locator: string): LocatorInfo;

  /** 插件初始化（可选） */
  init?(): Promise<void>;

  /** 插件清理（可选） */
  dispose?(): Promise<void>;
}
```

### DocumentConversionResult

```typescript
/**
 * 文档转换结果
 */
interface DocumentConversionResult {
  /** 转换后的 Markdown 内容 */
  markdown: string;

  /** Markdown 行号与原文位置的映射表 */
  mapping: PositionMapping[];
}
```

### PositionMapping

```typescript
/**
 * 位置映射条目
 */
interface PositionMapping {
  /** Markdown 中的行号范围 */
  markdownRange: {
    startLine: number;  // 起始行（从 1 开始）
    endLine: number;    // 结束行（含）
  };

  /** 原文档中的位置（插件自定义格式） */
  originalLocator: string;
}
```

### LocatorInfo

```typescript
/**
 * 定位符解析结果
 */
interface LocatorInfo {
  /** 用户可读的位置描述 */
  displayText: string;

  /** UI 跳转信息（可选，供前端使用） */
  jumpInfo?: unknown;
}
```

## 实现步骤

### 1. 创建插件项目

```bash
# 在 packages/plugins 目录下创建新插件
cd packages/plugins
mkdir plugin-xxx
cd plugin-xxx

# 初始化项目
pnpm init
```

### 2. 安装依赖

```json
{
  "name": "@agent-fs/plugin-xxx",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "dependencies": {
    "@agent-fs/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

### 3. 实现插件类

#### 3.1 基础结构

```typescript
// src/plugin.ts
import { DocumentPlugin, DocumentConversionResult, LocatorInfo } from '@agent-fs/core';

export class XXXPlugin implements DocumentPlugin {
  readonly name = 'xxx';
  readonly supportedExtensions = ['xxx', 'xx'];

  async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
    // 1. 读取文件
    const rawContent = await this.readFile(filePath);

    // 2. 解析文档结构
    const parsed = this.parseDocument(rawContent);

    // 3. 转换为 Markdown
    const markdown = this.convertToMarkdown(parsed);

    // 4. 建立位置映射
    const mapping = this.buildPositionMapping(parsed);

    return { markdown, mapping };
  }

  parseLocator(locator: string): LocatorInfo {
    // 解析自定义的 locator 格式
    return { displayText: locator };
  }
}
```

#### 3.2 读取文件

```typescript
private async readFile(filePath: string): Promise<Buffer | string> {
  // 文本文件
  if (this.isTextFormat()) {
    return readFileSync(filePath, 'utf-8');
  }

  // 二进制文件
  return readFileSync(filePath);
}
```

#### 3.3 解析文档

```typescript
private parseDocument(content: Buffer | string): ParsedDocument {
  // 使用第三方库或自定义解析器
  // 示例：
  // - PDF: pdfjs-dist, pdf-parse
  // - DOCX: docx, mammoth
  // - XLSX: xlsx

  return parser.parse(content);
}
```

#### 3.4 转换为 Markdown

```typescript
private convertToMarkdown(parsed: ParsedDocument): string {
  let markdown = '';

  for (const element of parsed.elements) {
    switch (element.type) {
      case 'heading':
        markdown += `${'#'.repeat(element.level)} ${element.text}\n\n`;
        break;
      case 'paragraph':
        markdown += `${element.text}\n\n`;
        break;
      case 'table':
        markdown += this.convertTableToMarkdown(element);
        break;
      // ...其他元素类型
    }
  }

  return markdown;
}
```

#### 3.5 建立位置映射

```typescript
private buildPositionMapping(parsed: ParsedDocument): PositionMapping[] {
  const mapping: PositionMapping[] = [];
  let currentLine = 1;

  for (const element of parsed.elements) {
    // 计算元素在 Markdown 中的行数
    const elementLines = this.countLines(element.markdown);

    // 创建映射条目
    mapping.push({
      markdownRange: {
        startLine: currentLine,
        endLine: currentLine + elementLines - 1
      },
      originalLocator: this.createLocator(element)
    });

    currentLine += elementLines;
  }

  return mapping;
}
```

### 4. 导出插件

```typescript
// src/index.ts
export { XXXPlugin } from './plugin';

// 工厂函数（可选）
export function createXXXPlugin(options?: XXXPluginOptions): XXXPlugin {
  return new XXXPlugin(options);
}
```

### 5. 注册插件

```typescript
// 在 packages/indexer/src/indexer.ts 中
import { XXXPlugin } from '@agent-fs/plugin-xxx';

export class Indexer {
  constructor(options: IndexerOptions = {}) {
    this.pluginManager = new PluginManager();

    // 注册默认插件
    this.pluginManager.register(new MarkdownPlugin());
    this.pluginManager.register(new PDFPlugin());
    this.pluginManager.register(new XXXPlugin());  // 新增
  }
}
```

## 定位符设计

### 定位符的作用

定位符（Locator）是插件自定义的字符串格式，用于在原文档中精确定位内容。它在以下环节中被使用：

1. **转换阶段**：插件为每个 Markdown 段落生成 `originalLocator`
2. **切分阶段**：Chunker 根据 `PositionMapping` 为每个 chunk 分配 locator
3. **存储阶段**：locator 保存在向量文档中
4. **搜索阶段**：搜索结果包含 locator，告诉用户内容来自哪里
5. **展示阶段**：`parseLocator()` 将 locator 转换为可读文本

### 定位符设计原则

| 原则 | 说明 | 示例 |
|------|------|------|
| **简洁性** | 尽量短小，避免冗余信息 | `page:5` 优于 `page_number:5` |
| **可读性** | 格式清晰，易于理解 | `line:10-20` 优于 `10:20` |
| **层次性** | 支持多层级定位 | `sheet:销售/range:A1:D20` |
| **可扩展性** | 预留扩展空间 | `page:5:100,200,300,400`（页码+坐标） |
| **一致性** | 同类型文档使用相同格式 | 所有表格都用 `sheet:name/range:range` |

### 常见定位符格式

| 文档类型 | 格式 | 示例 | 说明 |
|----------|------|------|------|
| Markdown | `line:N` 或 `line:N-M` | `line:42`<br>`line:10-20` | 行号（单行或范围） |
| PDF | `page:N` | `page:5` | 页码 |
| PDF（高级） | `page:N:x,y,w,h` | `page:5:100,200,300,400` | 页码 + 边界框坐标 |
| DOCX | `heading:path` | `heading:第一章/1.1概述` | 标题路径 |
| XLSX | `sheet:name/range:range` | `sheet:销售数据/range:A1:D20` | 工作表 + 单元格范围 |
| HTML | `id:element_id` | `id:section-intro` | DOM 元素 ID |
| Code | `file:line:col` | `file:42:15` | 行号 + 列号 |

### 实现 parseLocator()

```typescript
parseLocator(locator: string): LocatorInfo {
  // 示例 1: 解析行号
  if (locator.startsWith('line:')) {
    const match = locator.match(/^line:(\d+)(?:-(\d+))?$/);
    if (!match) return { displayText: locator };

    const start = parseInt(match[1]);
    const end = match[2] ? parseInt(match[2]) : start;

    return {
      displayText: end === start ? `第 ${start} 行` : `第 ${start}-${end} 行`,
      jumpInfo: { line: start, endLine: end }
    };
  }

  // 示例 2: 解析页码
  if (locator.startsWith('page:')) {
    const match = locator.match(/^page:(\d+)(?::(\d+),(\d+),(\d+),(\d+))?$/);
    if (!match) return { displayText: locator };

    const page = parseInt(match[1]);
    const bbox = match[2] ? {
      x: parseInt(match[2]),
      y: parseInt(match[3]),
      w: parseInt(match[4]),
      h: parseInt(match[5])
    } : undefined;

    return {
      displayText: `第 ${page} 页`,
      jumpInfo: { page, bbox }
    };
  }

  // 示例 3: 解析工作表范围
  if (locator.startsWith('sheet:')) {
    const match = locator.match(/^sheet:([^/]+)\/range:(.+)$/);
    if (!match) return { displayText: locator };

    return {
      displayText: `工作表 ${match[1]} - 区域 ${match[2]}`,
      jumpInfo: { sheet: match[1], range: match[2] }
    };
  }

  return { displayText: locator };
}
```

## 位置映射

### 为什么需要位置映射？

在文档转换为 Markdown 的过程中，原始文档的位置信息（如页码、段落编号、单元格坐标等）会丢失。位置映射（`PositionMapping`）显式记录这些信息，使得后续流程能够：

1. **双向查找**：从 Markdown 行号查找原文位置，或反向查找
2. **精确定位**：搜索结果能精确指出内容在原文档中的位置
3. **增量更新**：文档修改时能定位受影响的 chunks

### 映射粒度选择

| 粒度 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **段落级** | 映射条目少，性能好 | 定位不够精确 | Markdown、纯文本 |
| **页级** | 符合用户习惯 | PDF 页内无法细分 | PDF、扫描件 |
| **块级** | 平衡精度和性能 | 需要识别块边界 | DOCX、HTML |
| **行级** | 精确定位 | 映射条目多，开销大 | 代码、日志 |
| **单元格级** | 表格友好 | 仅适用于表格 | XLSX、CSV |

**推荐策略**：根据文档类型选择合适的粒度，例如：
- Markdown：段落级（连续非空行为一段）
- PDF：页级（或页内块级）
- DOCX：段落级（按 `<w:p>` 元素）
- XLSX：单元格范围级（如 A1:D20）

### 映射构建示例

#### 示例 1: Markdown 段落映射

```typescript
private createParagraphMapping(lines: string[]): PositionMapping[] {
  const mapping: PositionMapping[] = [];
  let paragraphStart = 1;
  let inParagraph = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.length > 0) {
      if (!inParagraph) {
        paragraphStart = i + 1;
        inParagraph = true;
      }
    } else if (inParagraph) {
      // 段落结束
      mapping.push({
        markdownRange: { startLine: paragraphStart, endLine: i },
        originalLocator: `line:${paragraphStart}${i > paragraphStart ? '-' + i : ''}`
      });
      inParagraph = false;
    }
  }

  // 处理最后一段
  if (inParagraph) {
    mapping.push({
      markdownRange: { startLine: paragraphStart, endLine: lines.length },
      originalLocator: `line:${paragraphStart}${lines.length > paragraphStart ? '-' + lines.length : ''}`
    });
  }

  return mapping;
}
```

#### 示例 2: PDF 页级映射

```typescript
private buildPositionMapping(
  markdown: string,
  pageContents: PageContent[]
): PositionMapping[] {
  const mapping: PositionMapping[] = [];
  const lines = markdown.split('\n');
  let currentLine = 1;

  for (const page of pageContents) {
    // 计算这一页在 Markdown 中的行数
    const pageLines = page.markdown.split('\n').length;

    mapping.push({
      markdownRange: {
        startLine: currentLine,
        endLine: currentLine + pageLines - 1
      },
      originalLocator: `page:${page.pageNumber}`
    });

    currentLine += pageLines;
  }

  return mapping;
}
```

#### 示例 3: DOCX 段落映射

```typescript
private buildPositionMapping(docx: DocxDocument): PositionMapping[] {
  const mapping: PositionMapping[] = [];
  let currentLine = 1;

  for (let i = 0; i < docx.paragraphs.length; i++) {
    const para = docx.paragraphs[i];
    const paraMarkdown = this.convertParagraphToMarkdown(para);
    const paraLines = paraMarkdown.split('\n').length;

    mapping.push({
      markdownRange: {
        startLine: currentLine,
        endLine: currentLine + paraLines - 1
      },
      originalLocator: this.createParagraphLocator(para, i)
    });

    currentLine += paraLines;
  }

  return mapping;
}

private createParagraphLocator(para: Paragraph, index: number): string {
  // 如果段落有标题样式，使用标题路径
  if (para.style?.startsWith('Heading')) {
    return `heading:${para.text}`;
  }
  // 否则使用段落索引
  return `para:${index}`;
}
```

### 映射的使用

映射在 **IndexPipeline** 中被使用，为每个 chunk 分配 locator：

```typescript
// packages/indexer/src/pipeline.ts
async processFile(filePath: string): Promise<void> {
  // 1. 插件转换
  const { markdown, mapping } = await plugin.toMarkdown(filePath);

  // 2. 切分为 chunks
  const chunks = chunker.chunk(markdown);

  // 3. 为每个 chunk 查找对应的 locator
  for (const chunk of chunks) {
    // 根据 chunk.markdownRange 在 mapping 中查找
    const locator = this.findLocatorForChunk(chunk, mapping);

    // 4. 存储时包含 locator
    await vectorStore.addDocument({
      chunk_id: `${fileId}:${chunkIndex}`,
      content: chunk.content,
      locator: locator,  // 关键字段
      // ...其他字段
    });
  }
}

private findLocatorForChunk(
  chunk: ChunkMetadata,
  mapping: PositionMapping[]
): string {
  // 查找包含 chunk 起始行的映射条目
  for (const entry of mapping) {
    if (
      chunk.markdownRange.startLine >= entry.markdownRange.startLine &&
      chunk.markdownRange.startLine <= entry.markdownRange.endLine
    ) {
      return entry.originalLocator;
    }
  }
  return 'unknown';
}
```

## 测试要求

### 单元测试

使用 Vitest 编写单元测试，覆盖以下场景：

```typescript
// src/plugin.test.ts
import { describe, it, expect } from 'vitest';
import { XXXPlugin } from './plugin';

describe('XXXPlugin', () => {
  const plugin = new XXXPlugin();

  it('应该有正确的名称和扩展名', () => {
    expect(plugin.name).toBe('xxx');
    expect(plugin.supportedExtensions).toEqual(['xxx', 'xx']);
  });

  it('应该正确转换文档为 Markdown', async () => {
    const result = await plugin.toMarkdown('test.xxx');

    expect(result.markdown).toBeTruthy();
    expect(result.mapping).toBeInstanceOf(Array);
    expect(result.mapping.length).toBeGreaterThan(0);
  });

  it('应该生成正确的位置映射', async () => {
    const result = await plugin.toMarkdown('test.xxx');

    for (const entry of result.mapping) {
      expect(entry.markdownRange.startLine).toBeGreaterThan(0);
      expect(entry.markdownRange.endLine).toBeGreaterThanOrEqual(
        entry.markdownRange.startLine
      );
      expect(entry.originalLocator).toBeTruthy();
    }
  });

  it('应该正确解析定位符', () => {
    const info = plugin.parseLocator('xxx:123');

    expect(info.displayText).toBeTruthy();
    expect(info.jumpInfo).toBeDefined();
  });

  it('应该处理空文件', async () => {
    // 测试边界情况
  });

  it('应该处理特殊字符', async () => {
    // 测试中文、emoji 等
  });
});
```

### 集成测试

测试插件与 IndexPipeline 的集成：

```typescript
describe('XXXPlugin Integration', () => {
  it('应该正确处理完整的索引流程', async () => {
    const indexer = new Indexer();
    const result = await indexer.indexFile('test.xxx');

    expect(result.chunks).toBeGreaterThan(0);
    expect(result.chunks[0].locator).toBeTruthy();
  });
});
```

### 测试覆盖率

- **最低要求**：80% 代码覆盖率
- **推荐**：90% 以上
- **关键方法**：`toMarkdown()` 和 `parseLocator()` 必须 100% 覆盖

```bash
# 运行测试
pnpm test

# 查看覆盖率
pnpm test -- --coverage
```

## 最佳实践

### 1. 错误处理

```typescript
async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
  try {
    // 检查文件是否存在
    if (!existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }

    // 检查文件大小
    const stats = statSync(filePath);
    if (stats.size > MAX_FILE_SIZE) {
      throw new Error(`文件过大: ${stats.size} bytes`);
    }

    // 转换逻辑
    const content = readFileSync(filePath);
    const markdown = await this.convert(content);

    return { markdown, mapping: this.buildMapping(markdown) };
  } catch (error) {
    // 包装错误，提供更多上下文
    throw new Error(
      `转换文档失败 (${filePath}): ${error.message}`,
      { cause: error }
    );
  }
}
```

### 2. 性能优化

```typescript
// ❌ 不推荐：每次都重新创建解析器
async toMarkdown(filePath: string) {
  const parser = new Parser();  // 重复创建
  return parser.parse(filePath);
}

// ✅ 推荐：复用解析器实例
export class XXXPlugin {
  private parser: Parser;

  async init() {
    this.parser = new Parser();
  }

  async toMarkdown(filePath: string) {
    return this.parser.parse(filePath);
  }

  async dispose() {
    this.parser.cleanup();
  }
}
```

### 3. 流式处理大文件

```typescript
async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
  const stream = createReadStream(filePath);
  let markdown = '';
  const mapping: PositionMapping[] = [];
  let currentLine = 1;

  for await (const chunk of stream) {
    const chunkMarkdown = this.processChunk(chunk);
    markdown += chunkMarkdown;

    // 增量构建映射
    const chunkMapping = this.buildChunkMapping(chunk, currentLine);
    mapping.push(...chunkMapping);

    currentLine += chunkMarkdown.split('\n').length;
  }

  return { markdown, mapping };
}
```

### 4. 配置管理

```typescript
export interface XXXPluginOptions {
  /** 最大文件大小（字节） */
  maxFileSize?: number;
  /** API 端点（如果调用外部服务） */
  apiEndpoint?: string;
  /** 超时时间（毫秒） */
  timeout?: number;
}

export class XXXPlugin implements DocumentPlugin {
  private options: Required<XXXPluginOptions>;

  constructor(options: XXXPluginOptions = {}) {
    this.options = {
      maxFileSize: options.maxFileSize ?? 100 * 1024 * 1024, // 100MB
      apiEndpoint: options.apiEndpoint ?? 'http://localhost:8000',
      timeout: options.timeout ?? 30000, // 30s
    };
  }
}
```

### 5. 日志记录

```typescript
import { logger } from '@agent-fs/core';

async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
  logger.info(`开始转换文档: ${filePath}`);

  const startTime = Date.now();
  const result = await this.convert(filePath);
  const elapsed = Date.now() - startTime;

  logger.info(`转换完成: ${filePath} (耗时 ${elapsed}ms, ${result.mapping.length} 个映射)`);

  return result;
}
```

### 6. 兼容性处理

```typescript
async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
  // 检测文档版本或格式
  const version = await this.detectVersion(filePath);

  // 根据版本选择不同的处理策略
  if (version >= 2.0) {
    return this.convertV2(filePath);
  } else {
    return this.convertV1(filePath);
  }
}
```

### 7. Markdown 质量

生成的 Markdown 应遵循以下原则：

```typescript
// ✅ 推荐：清晰的层级结构
## 第一章
### 1.1 节标题
段落内容...

### 1.2 节标题
段落内容...

// ❌ 不推荐：没有层级
第一章
1.1 节标题
段落内容...

// ✅ 推荐：保留表格结构
| 列1 | 列2 | 列3 |
|-----|-----|-----|
| A   | B   | C   |

// ❌ 不推荐：将表格转换为纯文本
列1: A, 列2: B, 列3: C

// ✅ 推荐：图片使用描述性 alt 文本
![图1: 系统架构图](image1.png)

// ❌ 不推荐：图片没有描述
![](image1.png)
```

## 常见问题

### Q1: 如何处理复杂的表格？

**A**: 表格转换为 Markdown 时有以下选项：

1. **简单表格**：直接转换为 Markdown 表格
   ```markdown
   | 姓名 | 年龄 | 城市 |
   |------|------|------|
   | 张三 | 25   | 北京 |
   | 李四 | 30   | 上海 |
   ```

2. **复杂表格**（合并单元格、嵌套等）：转换为描述性文本
   ```markdown
   **表格: 销售数据**
   - 第一季度: 100万（同比增长 20%）
     - 1月: 30万
     - 2月: 35万
     - 3月: 35万
   ```

3. **大表格**：截取关键信息 + 提供完整数据链接
   ```markdown
   **表格: 销售明细（前 10 行）**
   | 日期 | 产品 | 金额 |
   |------|------|------|
   | ...  | ...  | ...  |

   *完整数据: sheet:销售明细/range:A1:Z1000*
   ```

### Q2: 如何处理图片？

**A**: 图片处理策略：

1. **OCR 识别**：对于包含文字的图片，使用 OCR 提取文本
   ```markdown
   ![流程图](image1.png)

   *图片内容: 开始 → 数据收集 → 数据清洗 → 分析 → 结束*
   ```

2. **图片描述**：使用 Vision API 生成描述
   ```markdown
   ![柱状图](chart.png)

   *图表描述: 2023年各季度销售额对比，Q4 达到峰值 500万*
   ```

3. **保留引用**：仅保留图片引用，不提取内容
   ```markdown
   ![图1](images/diagram.png)
   ```

### Q3: 定位符应该多精确？

**A**: 根据使用场景权衡：

| 场景 | 推荐粒度 | 理由 |
|------|----------|------|
| 快速浏览 | 页级/段落级 | 足够定位，性能好 |
| 精确引用 | 段落级/句子级 | 满足引用需求 |
| 编辑修改 | 行级/块级 | 便于定位具体位置 |
| 代码文档 | 行级 + 列级 | 代码对位置敏感 |

**原则**：定位符精度应与文档类型的自然粒度一致（如 PDF 用页、代码用行）。

### Q4: 如何处理超大文件？

**A**: 多种策略：

1. **分块处理**：将大文件拆分为多个小块独立处理
2. **流式转换**：边读边转换，避免一次性加载全部内容
3. **外部服务**：调用专门的转换服务（如 MinerU）
4. **限制文件大小**：在 `init()` 中设置合理的上限

```typescript
async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
  const stats = statSync(filePath);

  // 小文件：直接处理
  if (stats.size < 10 * 1024 * 1024) {
    return this.convertDirectly(filePath);
  }

  // 大文件：分块处理
  if (stats.size < 100 * 1024 * 1024) {
    return this.convertInChunks(filePath);
  }

  // 超大文件：拒绝处理
  throw new Error(`文件过大 (${stats.size} bytes), 请分割后重试`);
}
```

### Q5: 是否支持增量更新？

**A**: 插件本身无需处理增量更新，这由 Indexer 负责：

1. Indexer 检测文件修改时间
2. 对于修改过的文件，重新调用 `toMarkdown()`
3. 删除旧的 chunks，插入新的 chunks

插件只需确保：
- 相同文件的多次转换结果一致（幂等性）
- 定位符格式保持稳定

### Q6: 如何调试插件？

**A**: 调试技巧：

1. **单元测试**：为每个方法编写测试用例
   ```bash
   pnpm test -- --watch
   ```

2. **日志输出**：记录关键步骤和中间结果
   ```typescript
   logger.debug('Markdown 长度:', markdown.length);
   logger.debug('映射条目数:', mapping.length);
   ```

3. **保存中间文件**：将转换结果保存到临时目录
   ```typescript
   writeFileSync('/tmp/debug.md', markdown);
   writeFileSync('/tmp/debug-mapping.json', JSON.stringify(mapping, null, 2));
   ```

4. **使用调试器**：在 VS Code 中设置断点
   ```json
   // .vscode/launch.json
   {
     "type": "node",
     "request": "launch",
     "name": "Debug Plugin",
     "program": "${workspaceFolder}/packages/plugins/plugin-xxx/src/plugin.test.ts",
     "runtimeArgs": ["--loader", "tsx"]
   }
   ```

### Q7: 如何发布插件？

**A**: 发布流程：

1. **内置插件**：直接合并到 `packages/plugins/`
2. **第三方插件**：发布到 npm
   ```bash
   cd packages/plugins/plugin-xxx
   pnpm build
   pnpm publish
   ```

3. **动态加载**（规划中）：
   ```yaml
   # ~/.agent_fs/config.yaml
   plugins:
     - name: xxx
       package: '@org/plugin-xxx'
       version: '^1.0.0'
   ```

## 参考资源

### 现有插件实现

| 插件 | 文件路径 | 说明 |
|------|----------|------|
| Markdown | `packages/plugins/plugin-markdown/` | 最简单的实现，直接返回原内容 |
| PDF | `packages/plugins/plugin-pdf/` | 调用 MinerU API 转换 |

### 相关文档

- [架构设计文档](../plans/2025-02-02-agent-fs-design.md) - 整体架构和接口设计
- [代码规范](./code-standards.md) - 编码风格和质量要求
- [Markdown 插件设计](../plans/2025-02-02-plan-B4-plugin-md.md) - Markdown 插件详细设计
- [PDF 插件设计](../plans/2025-02-02-plan-P1-plugin-pdf.md) - PDF 插件详细设计

### 工具和库

| 用途 | 推荐库 |
|------|--------|
| Markdown 解析 | `remark`, `unified` |
| PDF 解析 | `pdf-parse`, `pdfjs-dist` |
| DOCX 解析 | `mammoth`, `docx` |
| XLSX 解析 | `xlsx`, `exceljs` |
| HTML 解析 | `jsdom`, `cheerio` |
| Token 计数 | `tiktoken-js`, `gpt-tokenizer` |
| 中文分词 | `nodejieba` |

---

**祝你开发顺利！如有疑问，请查阅相关文档或提交 Issue。**

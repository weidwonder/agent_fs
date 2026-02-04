# Plugin DOCX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. (@superpowers:executing-plans)

**Goal:** 实现 DOC/DOCX 文档处理插件，TypeScript 插件通过 stdio 调用 .NET 8 常驻转换服务输出 Markdown + 位置映射。

**Architecture:** TS 插件管理 C# 进程与协议；C# 使用 NPOI 解析 .docx，必要时将 .doc 转换为 .docx 后复用同一解析逻辑；映射以 heading/para/table 为粒度。

**Tech Stack:** TypeScript/Node.js, .NET 8, NPOI, LibreOffice/Word COM

**依赖:** [A] foundation

**被依赖:** [F] indexer

---

## 设计对齐（来自 `docs/plans/2025-02-03-plugin-docx-design.md`）

- 通信协议：stdio + JSON，单行一条消息
- 映射粒度：heading/para/table
- 图片：Markdown 占位符 `![image](img-{paraIdx}-{seq})`
- .doc：本地转换为 .docx 后统一用 NPOI 处理（macOS/Linux: LibreOffice，Windows: Word COM）

---

## 成功标准

- [ ] `plugin-docx` 包可被 `@agent-fs/indexer` 正常引用与注册
- [ ] `.docx` → Markdown 转换正确，映射行号准确
- [ ] `.doc` 在 Windows/macOS/Linux 有可用 fallback 路径
- [ ] `parseLocator` 支持 heading/para/table
- [ ] TS 单元测试覆盖核心逻辑，提供可执行的集成测试脚本

---

## Task 1: 创建 `plugin-docx` 包结构与协议定义

**Files:**
- Create: `packages/plugins/plugin-docx/package.json`
- Create: `packages/plugins/plugin-docx/tsconfig.json`
- Create: `packages/plugins/plugin-docx/src/index.ts`
- Create: `packages/plugins/plugin-docx/src/protocol.ts`

**Step 1: 创建目录**

Run: `mkdir -p packages/plugins/plugin-docx/src`

Expected: `packages/plugins/plugin-docx/src` 目录存在

**Step 2: 添加 `package.json`**

```json
{
  "name": "@agent-fs/plugin-docx",
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
    "build:dotnet": "dotnet publish ./dotnet/DocxConverter/DocxConverter.csproj -c Release -o ./dotnet/DocxConverter/bin/Release/net8.0/publish",
    "clean": "rm -rf dist dotnet/DocxConverter/bin",
    "lint": "eslint src",
    "test": "vitest run --root ../../.."
  },
  "dependencies": {
    "@agent-fs/core": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0"
  }
}
```

**Step 3: 添加 `tsconfig.json`**

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

**Step 4: 添加 `protocol.ts`**

```typescript
export type DocxMethod = 'convert' | 'shutdown';

export interface DocxRequest {
  id: string;
  method: DocxMethod;
  params?: {
    filePath: string;
  };
}

export interface DocxMapping {
  startLine: number;
  endLine: number;
  locator: string;
}

export interface DocxSuccessData {
  markdown: string;
  mappings: DocxMapping[];
}

export type DocxErrorCode =
  | 'FILE_NOT_FOUND'
  | 'UNSUPPORTED_FORMAT'
  | 'CONVERSION_FAILED'
  | 'FALLBACK_UNAVAILABLE'
  | 'FALLBACK_FAILED'
  | 'INVALID_REQUEST';

export interface DocxErrorInfo {
  code: DocxErrorCode;
  message: string;
}

export interface DocxSuccessResponse {
  id: string;
  success: true;
  data: DocxSuccessData;
}

export interface DocxErrorResponse {
  id: string;
  success: false;
  error: DocxErrorInfo;
}

export type DocxResponse = DocxSuccessResponse | DocxErrorResponse;
```

**Step 5: 添加 `index.ts`（临时仅导出协议类型）**

```typescript
// @agent-fs/plugin-docx
export type {
  DocxRequest,
  DocxResponse,
  DocxSuccessData,
  DocxMapping,
  DocxErrorCode,
} from './protocol';
```

**Step 6: 运行构建**

Run: `pnpm --filter @agent-fs/plugin-docx build`

Expected: `tsc` 无错误输出

**Step 7: 提交**

```bash
git add packages/plugins/plugin-docx

git commit -m "chore(plugin-docx): create package skeleton and protocol types"
```

---

## Task 2: 实现 DocxService（TDD）

**Files:**
- Create: `packages/plugins/plugin-docx/src/service.test.ts`
- Create: `packages/plugins/plugin-docx/src/service.ts`

**Step 1: 编写失败测试 `service.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { DocxService } from './service';

function createFakeProcess() {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const stderr = new PassThrough();
  const emitter = new EventEmitter();

  const process = Object.assign(emitter, {
    stdout,
    stdin,
    stderr,
    kill: vi.fn(),
  });

  return { process, stdout, stdin };
}

describe('DocxService', () => {
  let converterPath: string;

  beforeEach(() => {
    converterPath = '/tmp/DocxConverter.dll';
  });

  it('resolves convert when success response arrives', async () => {
    const { process, stdout, stdin } = createFakeProcess();
    const spawnFn = vi.fn().mockReturnValue(process as any);
    const service = new DocxService({ spawnFn, converterPath });

    let written = '';
    stdin.on('data', (chunk) => {
      written += chunk.toString();
    });

    await service.start();
    const promise = service.convert('/tmp/demo.docx');

    await new Promise((r) => setImmediate(r));
    const request = JSON.parse(written.trim());

    stdout.write(
      JSON.stringify({
        id: request.id,
        success: true,
        data: { markdown: '# Title', mappings: [] },
      }) + '\n',
    );

    await expect(promise).resolves.toEqual({
      markdown: '# Title',
      mappings: [],
    });
  });

  it('rejects convert when error response arrives', async () => {
    const { process, stdout, stdin } = createFakeProcess();
    const spawnFn = vi.fn().mockReturnValue(process as any);
    const service = new DocxService({ spawnFn, converterPath });

    let written = '';
    stdin.on('data', (chunk) => {
      written += chunk.toString();
    });

    await service.start();
    const promise = service.convert('/tmp/demo.docx');

    await new Promise((r) => setImmediate(r));
    const request = JSON.parse(written.trim());

    stdout.write(
      JSON.stringify({
        id: request.id,
        success: false,
        error: { code: 'FILE_NOT_FOUND', message: 'not found' },
      }) + '\n',
    );

    await expect(promise).rejects.toThrow('FILE_NOT_FOUND');
  });
});
```

**Step 2: 运行测试（应失败）**

Run: `pnpm --filter @agent-fs/plugin-docx test -- --runTestsByPath packages/plugins/plugin-docx/src/service.test.ts`

Expected: FAIL（提示 `DocxService` 不存在）

**Step 3: 实现 `service.ts`（最小可行实现）**

```typescript
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { DocxRequest, DocxResponse, DocxSuccessData } from './protocol';

export interface DocxProcess {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  kill: (signal?: NodeJS.Signals) => void;
  on: (event: 'exit' | 'close' | 'error', listener: (...args: any[]) => void) => void;
}

export interface DocxServiceOptions {
  converterPath?: string;
  spawnFn?: (command: string, args: string[]) => DocxProcess;
  timeoutMs?: number;
}

type PendingRequest = {
  resolve: (data: DocxSuccessData) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
};

export class DocxService {
  private process: DocxProcess | null = null;
  private pending = new Map<string, PendingRequest>();
  private buffer = '';
  private spawnFn: (command: string, args: string[]) => DocxProcess;
  private converterPath: string;
  private timeoutMs: number;

  constructor(options: DocxServiceOptions = {}) {
    this.spawnFn = options.spawnFn ?? ((command, args) => spawn(command, args) as DocxProcess);
    this.converterPath = options.converterPath ?? resolveConverterPath();
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async start(): Promise<void> {
    if (this.process) return;

    if (!existsSync(this.converterPath)) {
      throw new Error(
        `DocxConverter 未找到: ${this.converterPath}，请先运行 pnpm --filter @agent-fs/plugin-docx build:dotnet`,
      );
    }

    this.process = this.spawnFn('dotnet', [this.converterPath]);
    this.process.stdout.on('data', (chunk: Buffer) => this.handleStdout(chunk));
    this.process.stderr.on('data', () => {
      // stderr 留给调用方自行观察
    });
    this.process.on('exit', () => this.rejectAll(new Error('DocxConverter 已退出')));
  }

  async convert(filePath: string): Promise<DocxSuccessData> {
    if (!this.process) {
      await this.start();
    }

    const id = randomUUID();
    const request: DocxRequest = {
      id,
      method: 'convert',
      params: { filePath },
    };

    const payload = JSON.stringify(request) + '\n';
    this.process?.stdin.write(payload);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('DocxConverter 请求超时'));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
    });
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    const request: DocxRequest = {
      id: randomUUID(),
      method: 'shutdown',
    };

    this.process.stdin.write(JSON.stringify(request) + '\n');
    this.process.kill();
    this.process = null;
  }

  private handleStdout(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let index = this.buffer.indexOf('\n');

    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);

      if (line.length > 0) {
        this.handleResponseLine(line);
      }

      index = this.buffer.indexOf('\n');
    }
  }

  private handleResponseLine(line: string): void {
    let response: DocxResponse;

    try {
      response = JSON.parse(line) as DocxResponse;
    } catch {
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) return;

    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(response.id);

    if (response.success) {
      pending.resolve(response.data);
    } else {
      pending.reject(new Error(`${response.error.code}: ${response.error.message}`));
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function resolveConverterPath(): string {
  const custom = process.env.AGENT_FS_DOCX_CONVERTER;
  if (custom) return custom;

  const baseDir = dirname(fileURLToPath(import.meta.url));
  return join(
    baseDir,
    '..',
    'dotnet',
    'DocxConverter',
    'bin',
    'Release',
    'net8.0',
    'publish',
    'DocxConverter.dll',
  );
}
```

**Step 4: 运行测试（应通过）**

Run: `pnpm --filter @agent-fs/plugin-docx test -- --runTestsByPath packages/plugins/plugin-docx/src/service.test.ts`

Expected: PASS

**Step 5: 提交**

```bash
git add packages/plugins/plugin-docx/src/service.ts packages/plugins/plugin-docx/src/service.test.ts

git commit -m "feat(plugin-docx): add DocxService with stdio protocol"
```

---

## Task 3: 实现 DocxPlugin（TDD）

**Files:**
- Create: `packages/plugins/plugin-docx/src/plugin.test.ts`
- Create: `packages/plugins/plugin-docx/src/plugin.ts`
- Modify: `packages/plugins/plugin-docx/src/index.ts`

**Step 1: 编写失败测试 `plugin.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { DocxPlugin } from './plugin';

function createMockService() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    convert: vi.fn().mockResolvedValue({
      markdown: '# 标题',
      mappings: [
        { startLine: 1, endLine: 1, locator: 'heading:1:标题' },
        { startLine: 3, endLine: 3, locator: 'para:0' },
      ],
    }),
  };
}

describe('DocxPlugin', () => {
  it('should expose correct name and extensions', () => {
    const plugin = new DocxPlugin();
    expect(plugin.name).toBe('docx');
    expect(plugin.supportedExtensions).toContain('doc');
    expect(plugin.supportedExtensions).toContain('docx');
  });

  it('should convert mapping to PositionMapping', async () => {
    const service = createMockService();
    const plugin = new DocxPlugin({ service });

    const result = await plugin.toMarkdown('/tmp/demo.docx');
    expect(result.markdown).toBe('# 标题');
    expect(result.mapping).toEqual([
      {
        markdownRange: { startLine: 1, endLine: 1 },
        originalLocator: 'heading:1:标题',
      },
      {
        markdownRange: { startLine: 3, endLine: 3 },
        originalLocator: 'para:0',
      },
    ]);
  });

  it('should parse heading locator', () => {
    const plugin = new DocxPlugin();
    expect(plugin.parseLocator('heading:2:背景').displayText).toBe('## 背景');
  });

  it('should parse para locator', () => {
    const plugin = new DocxPlugin();
    expect(plugin.parseLocator('para:5').displayText).toBe('第 6 段');
  });

  it('should parse table locator', () => {
    const plugin = new DocxPlugin();
    expect(plugin.parseLocator('table:0').displayText).toBe('表格 1');
  });
});
```

**Step 2: 运行测试（应失败）**

Run: `pnpm --filter @agent-fs/plugin-docx test -- --runTestsByPath packages/plugins/plugin-docx/src/plugin.test.ts`

Expected: FAIL（提示 `DocxPlugin` 不存在）

**Step 3: 实现 `plugin.ts` 并更新 `index.ts`**

```typescript
import type {
  DocumentConversionResult,
  DocumentPlugin,
  LocatorInfo,
  PositionMapping,
} from '@agent-fs/core';
import { DocxService } from './service';

export interface DocxServiceLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  convert(filePath: string): Promise<{
    markdown: string;
    mappings: { startLine: number; endLine: number; locator: string }[];
  }>;
}

export interface DocxPluginOptions {
  service?: DocxServiceLike;
}

export class DocxPlugin implements DocumentPlugin {
  readonly name = 'docx';
  readonly supportedExtensions = ['doc', 'docx'];

  private service: DocxServiceLike;

  constructor(options: DocxPluginOptions = {}) {
    this.service = options.service ?? new DocxService();
  }

  async init(): Promise<void> {
    await this.service.start();
  }

  async dispose(): Promise<void> {
    await this.service.stop();
  }

  async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
    const result = await this.service.convert(filePath);

    const mapping: PositionMapping[] = result.mappings.map((item) => ({
      markdownRange: { startLine: item.startLine, endLine: item.endLine },
      originalLocator: item.locator,
    }));

    return { markdown: result.markdown, mapping };
  }

  parseLocator(locator: string): LocatorInfo {
    const headingMatch = locator.match(/^heading:(\d+):(.+)$/);
    if (headingMatch) {
      const level = Number.parseInt(headingMatch[1], 10);
      const title = headingMatch[2];
      return {
        displayText: `${'#'.repeat(level)} ${title}`,
        jumpInfo: { type: 'heading', level, title },
      };
    }

    const paraMatch = locator.match(/^para:(\d+)$/);
    if (paraMatch) {
      const index = Number.parseInt(paraMatch[1], 10);
      return {
        displayText: `第 ${index + 1} 段`,
        jumpInfo: { type: 'paragraph', index },
      };
    }

    const tableMatch = locator.match(/^table:(\d+)$/);
    if (tableMatch) {
      const index = Number.parseInt(tableMatch[1], 10);
      return {
        displayText: `表格 ${index + 1}`,
        jumpInfo: { type: 'table', index },
      };
    }

    return { displayText: locator };
  }
}

export function createDocxPlugin(options?: DocxPluginOptions): DocumentPlugin {
  return new DocxPlugin(options);
}
```

更新 `index.ts`：

```typescript
// @agent-fs/plugin-docx
export { DocxPlugin, createDocxPlugin, type DocxPluginOptions } from './plugin';
export type {
  DocxRequest,
  DocxResponse,
  DocxSuccessData,
  DocxMapping,
  DocxErrorCode,
} from './protocol';
```

**Step 4: 运行测试（应通过）**

Run: `pnpm --filter @agent-fs/plugin-docx test -- --runTestsByPath packages/plugins/plugin-docx/src/plugin.test.ts`

Expected: PASS

**Step 5: 提交**

```bash
git add packages/plugins/plugin-docx/src/plugin.ts packages/plugins/plugin-docx/src/plugin.test.ts packages/plugins/plugin-docx/src/index.ts

git commit -m "feat(plugin-docx): implement DocxPlugin with locator parsing"
```

---

## Task 4: 创建 .NET DocxConverter 项目骨架

**Files:**
- Create: `packages/plugins/plugin-docx/dotnet/DocxConverter.sln`
- Create: `packages/plugins/plugin-docx/dotnet/DocxConverter/DocxConverter.csproj`
- Create: `packages/plugins/plugin-docx/dotnet/DocxConverter/Models.cs`
- Create: `packages/plugins/plugin-docx/dotnet/DocxConverter/Converter.cs`
- Create: `packages/plugins/plugin-docx/dotnet/DocxConverter/Program.cs`

**Step 1: 生成解决方案与项目结构**

Run:
```bash
mkdir -p packages/plugins/plugin-docx/dotnet

dotnet new sln -n DocxConverter -o packages/plugins/plugin-docx/dotnet

dotnet new console -n DocxConverter -o packages/plugins/plugin-docx/dotnet/DocxConverter

dotnet sln packages/plugins/plugin-docx/dotnet/DocxConverter.sln add packages/plugins/plugin-docx/dotnet/DocxConverter/DocxConverter.csproj
```

Expected: 生成 `DocxConverter.sln` 与 `DocxConverter.csproj`

**Step 2: 更新 `DocxConverter.csproj`**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="NPOI" Version="2.7.1" />
  </ItemGroup>
</Project>
```

**Step 3: 添加 `Models.cs`**

```csharp
namespace DocxConverter;

public record ConvertRequest(string Id, string Method, ConvertParams? Params);

public record ConvertParams(string FilePath);

public record ConvertResponse(string Id, bool Success, ConvertData? Data, ErrorInfo? Error);

public record ConvertData(string Markdown, List<Mapping> Mappings);

public record Mapping(int StartLine, int EndLine, string Locator);

public record ErrorInfo(string Code, string Message);

public static class ErrorCodes
{
    public const string FileNotFound = "FILE_NOT_FOUND";
    public const string UnsupportedFormat = "UNSUPPORTED_FORMAT";
    public const string ConversionFailed = "CONVERSION_FAILED";
    public const string FallbackUnavailable = "FALLBACK_UNAVAILABLE";
    public const string FallbackFailed = "FALLBACK_FAILED";
    public const string InvalidRequest = "INVALID_REQUEST";
}

public class DocxException : Exception
{
    public string Code { get; }

    public DocxException(string code, string message) : base(message)
    {
        Code = code;
    }
}
```

**Step 4: 添加 `Converter.cs`（先放空实现，后续任务完善）**

```csharp
namespace DocxConverter;

public class Converter
{
    public ConvertData Convert(string filePath)
    {
        if (!File.Exists(filePath))
        {
            throw new DocxException(ErrorCodes.FileNotFound, "文件不存在");
        }

        throw new DocxException(ErrorCodes.ConversionFailed, "转换逻辑未实现");
    }
}
```

**Step 5: 添加 `Program.cs`（占位）**

```csharp
namespace DocxConverter;

public static class Program
{
    public static void Main(string[] args)
    {
        Console.WriteLine("DocxConverter bootstrapped");
    }
}
```

**Step 6: 运行构建**

Run: `dotnet build packages/plugins/plugin-docx/dotnet/DocxConverter/DocxConverter.csproj`

Expected: BUILD SUCCESS

**Step 7: 提交**

```bash
git add packages/plugins/plugin-docx/dotnet

git commit -m "chore(plugin-docx): add DocxConverter dotnet project skeleton"
```

---

## Task 5: 实现 .docx 转换与 Markdown 映射

**Files:**
- Modify: `packages/plugins/plugin-docx/dotnet/DocxConverter/Converter.cs`

**Step 1: 编写失败验证（手动）**

Run:
```bash
dotnet run --project packages/plugins/plugin-docx/dotnet/DocxConverter/DocxConverter.csproj
```

Expected: 仍输出 `DocxConverter bootstrapped`

**Step 2: 实现完整转换逻辑**

```csharp
using System.Text;
using System.Text.RegularExpressions;
using NPOI.XWPF.UserModel;

namespace DocxConverter;

public class Converter
{
    public ConvertData Convert(string filePath)
    {
        if (!File.Exists(filePath))
        {
            throw new DocxException(ErrorCodes.FileNotFound, "文件不存在");
        }

        var ext = Path.GetExtension(filePath).ToLowerInvariant();
        return ext switch
        {
            ".docx" => ConvertDocx(filePath),
            ".doc" => ConvertDoc(filePath),
            _ => throw new DocxException(ErrorCodes.UnsupportedFormat, "不支持的格式"),
        };
    }

    private ConvertData ConvertDocx(string filePath)
    {
        using var stream = File.OpenRead(filePath);
        var document = new XWPFDocument(stream);
        var builder = new MarkdownBuilder();

        var paraIndex = 0;
        var tableIndex = 0;

        foreach (var element in document.BodyElements)
        {
            if (element is XWPFParagraph paragraph)
            {
                var markdown = RenderParagraph(paragraph, paraIndex, out var locator);
                builder.AppendBlock(markdown, locator);
                paraIndex += 1;
                continue;
            }

            if (element is XWPFTable table)
            {
                var markdown = RenderTable(table);
                builder.AppendBlock(markdown, $"table:{tableIndex}");
                tableIndex += 1;
            }
        }

        return builder.Build();
    }

    private string RenderParagraph(XWPFParagraph paragraph, int paraIndex, out string locator)
    {
        var text = paragraph.Text?.Trim() ?? string.Empty;
        var imageCount = 0;

        foreach (var run in paragraph.Runs)
        {
            var pictures = run.GetEmbeddedPictures();
            if (pictures == null) continue;

            foreach (var _ in pictures)
            {
                text = string.IsNullOrWhiteSpace(text)
                    ? $"![image](img-{paraIndex}-{imageCount})"
                    : $"{text} ![image](img-{paraIndex}-{imageCount})";
                imageCount += 1;
            }
        }

        var headingLevel = TryGetHeadingLevel(paragraph);
        if (headingLevel > 0)
        {
            locator = $"heading:{headingLevel}:{text}";
            return $"{new string('#', headingLevel)} {text}".Trim();
        }

        locator = $"para:{paraIndex}";
        return text;
    }

    private int TryGetHeadingLevel(XWPFParagraph paragraph)
    {
        var style = paragraph.Style ?? string.Empty;
        var match = Regex.Match(style, @"Heading(\d)", RegexOptions.IgnoreCase);
        if (match.Success && int.TryParse(match.Groups[1].Value, out var level))
        {
            return level;
        }
        return 0;
    }

    private string RenderTable(XWPFTable table)
    {
        if (table.Rows.Count == 0) return string.Empty;

        var sb = new StringBuilder();
        var headerCells = table.Rows[0].GetTableCells().Select(cell => CleanCell(cell.GetText())).ToList();
        sb.Append("| ").Append(string.Join(" | ", headerCells)).Append(" |");
        sb.AppendLine();
        sb.Append("| ").Append(string.Join(" | ", headerCells.Select(_ => "---"))).Append(" |");

        for (var i = 1; i < table.Rows.Count; i += 1)
        {
            var rowCells = table.Rows[i].GetTableCells().Select(cell => CleanCell(cell.GetText())).ToList();
            sb.AppendLine();
            sb.Append("| ").Append(string.Join(" | ", rowCells)).Append(" |");
        }

        return sb.ToString();
    }

    private string CleanCell(string? text)
    {
        return (text ?? string.Empty).Replace("\r", "").Replace("\n", " ").Trim();
    }

    private sealed class MarkdownBuilder
    {
        private readonly List<string> lines = new();
        private readonly List<Mapping> mappings = new();

        public void AppendBlock(string markdown, string locator)
        {
            if (string.IsNullOrWhiteSpace(markdown)) return;

            if (lines.Count > 0)
            {
                lines.Add(string.Empty);
            }

            var startLine = lines.Count + 1;
            var blockLines = markdown.Split('\n');
            lines.AddRange(blockLines);
            var endLine = lines.Count;

            mappings.Add(new Mapping(startLine, endLine, locator));
        }

        public ConvertData Build()
        {
            return new ConvertData(string.Join("\n", lines), mappings);
        }
    }

    private ConvertData ConvertDoc(string filePath)
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"agent-fs-docx-{Guid.NewGuid()}");
        Directory.CreateDirectory(tempDir);

        try
        {
            var docxPath = ConvertDocToDocx(filePath, tempDir);
            return ConvertDocx(docxPath);
        }
        finally
        {
            if (Directory.Exists(tempDir))
            {
                Directory.Delete(tempDir, true);
            }
        }
    }

    private string ConvertDocToDocx(string docPath, string outDir)
    {
        if (OperatingSystem.IsWindows())
        {
            return ConvertWithWordCom(docPath, outDir);
        }

        return ConvertWithLibreOffice(docPath, outDir);
    }

    private string ConvertWithLibreOffice(string docPath, string outDir)
    {
        var startInfo = new System.Diagnostics.ProcessStartInfo
        {
            FileName = "soffice",
            Arguments = $"--headless --convert-to docx --outdir \"{outDir}\" \"{docPath}\"",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        try
        {
            using var process = System.Diagnostics.Process.Start(startInfo);
            if (process == null)
            {
                throw new DocxException(ErrorCodes.FallbackUnavailable, "LibreOffice 启动失败");
            }

            process.WaitForExit();
            var outputPath = Path.Combine(outDir, Path.GetFileNameWithoutExtension(docPath) + ".docx");

            if (process.ExitCode != 0 || !File.Exists(outputPath))
            {
                throw new DocxException(ErrorCodes.FallbackFailed, "LibreOffice 转换失败");
            }

            return outputPath;
        }
        catch (System.ComponentModel.Win32Exception)
        {
            throw new DocxException(ErrorCodes.FallbackUnavailable, "未找到 LibreOffice (soffice)");
        }
    }

    private string ConvertWithWordCom(string docPath, string outDir)
    {
        var wordType = Type.GetTypeFromProgID("Word.Application");
        if (wordType == null)
        {
            throw new DocxException(ErrorCodes.FallbackUnavailable, "未安装 Microsoft Word");
        }

        dynamic? wordApp = null;
        dynamic? doc = null;
        var outputPath = Path.Combine(outDir, Path.GetFileNameWithoutExtension(docPath) + ".docx");

        try
        {
            wordApp = Activator.CreateInstance(wordType);
            wordApp.Visible = false;
            doc = wordApp.Documents.Open(docPath, ReadOnly: true, Visible: false);
            const int wdFormatXMLDocument = 16;
            doc.SaveAs2(outputPath, wdFormatXMLDocument);
            doc.Close(false);
            wordApp.Quit();
        }
        catch
        {
            throw new DocxException(ErrorCodes.FallbackFailed, "Word COM 转换失败");
        }
        finally
        {
            if (doc != null) System.Runtime.InteropServices.Marshal.FinalReleaseComObject(doc);
            if (wordApp != null) System.Runtime.InteropServices.Marshal.FinalReleaseComObject(wordApp);
        }

        if (!File.Exists(outputPath))
        {
            throw new DocxException(ErrorCodes.FallbackFailed, "Word COM 未生成 docx");
        }

        return outputPath;
    }
}
```

**Step 3: 运行构建**

Run: `dotnet build packages/plugins/plugin-docx/dotnet/DocxConverter/DocxConverter.csproj`

Expected: BUILD SUCCESS

**Step 4: 提交**

```bash
git add packages/plugins/plugin-docx/dotnet/DocxConverter/Converter.cs

git commit -m "feat(plugin-docx): implement docx conversion and mapping"
```

---

## Task 6: 实现 stdio 协议主循环

**Files:**
- Modify: `packages/plugins/plugin-docx/dotnet/DocxConverter/Program.cs`

**Step 1: 编写主循环逻辑**

```csharp
using System.Text.Json;
using DocxConverter;

var converter = new Converter();
var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
};

string? line;
while ((line = Console.ReadLine()) != null)
{
    if (string.IsNullOrWhiteSpace(line)) continue;

    ConvertRequest? request = null;
    try
    {
        request = JsonSerializer.Deserialize<ConvertRequest>(line, jsonOptions);
    }
    catch
    {
        continue;
    }

    if (request == null || string.IsNullOrWhiteSpace(request.Method))
    {
        WriteError("unknown", ErrorCodes.InvalidRequest, "无效请求", jsonOptions);
        continue;
    }

    if (request.Method == "shutdown")
    {
        WriteSuccess(request.Id, new ConvertData(string.Empty, new List<Mapping>()), jsonOptions);
        break;
    }

    if (request.Method != "convert" || request.Params == null)
    {
        WriteError(request.Id, ErrorCodes.InvalidRequest, "无效请求", jsonOptions);
        continue;
    }

    try
    {
        var data = converter.Convert(request.Params.FilePath);
        WriteSuccess(request.Id, data, jsonOptions);
    }
    catch (DocxException ex)
    {
        WriteError(request.Id, ex.Code, ex.Message, jsonOptions);
    }
    catch (Exception ex)
    {
        WriteError(request.Id, ErrorCodes.ConversionFailed, ex.Message, jsonOptions);
    }
}

static void WriteSuccess(string id, ConvertData data, JsonSerializerOptions options)
{
    var response = new ConvertResponse(id, true, data, null);
    Console.WriteLine(JsonSerializer.Serialize(response, options));
}

static void WriteError(string id, string code, string message, JsonSerializerOptions options)
{
    var response = new ConvertResponse(id, false, null, new ErrorInfo(code, message));
    Console.WriteLine(JsonSerializer.Serialize(response, options));
}
```

**Step 2: 手动运行验证**

Run:
```bash
printf '{"id":"1","method":"shutdown"}\n' | dotnet run --project packages/plugins/plugin-docx/dotnet/DocxConverter/DocxConverter.csproj
```

Expected: 输出 JSON 成功响应并退出

**Step 3: 提交**

```bash
git add packages/plugins/plugin-docx/dotnet/DocxConverter/Program.cs

git commit -m "feat(plugin-docx): add stdio protocol loop"
```

---

## Task 7: 添加插件 README 与集成脚本

**Files:**
- Create: `packages/plugins/plugin-docx/README.md`
- Create: `packages/plugins/plugin-docx/scripts/test-with-docx.ts`

**Step 1: 创建 README**

```markdown
# @agent-fs/plugin-docx

DOC/DOCX 文档处理插件，通过 .NET 8 DocxConverter 将 Word 文档转换为 Markdown，并保留位置映射。

## 功能

- `.docx` 转换为 Markdown（标题/段落/表格）
- `.doc` 通过本地转换后处理（macOS/Linux: LibreOffice；Windows: Word COM）
- 输出定位符：`heading:{level}:{text}` / `para:{index}` / `table:{index}`

## 环境要求

- .NET 8 Runtime
- LibreOffice（macOS/Linux，需可执行 `soffice`）或 Microsoft Word（Windows）

## 构建

```bash
pnpm --filter @agent-fs/plugin-docx build
pnpm --filter @agent-fs/plugin-docx build:dotnet
```

## 使用示例

```typescript
import { DocxPlugin } from '@agent-fs/plugin-docx';

const plugin = new DocxPlugin();
await plugin.init();
const result = await plugin.toMarkdown('/path/to/file.docx');
console.log(result.markdown);
await plugin.dispose();
```

## 手动测试

```bash
npx tsx scripts/test-with-docx.ts /path/to/file.docx
```
```

**Step 2: 添加测试脚本**

```typescript
import { DocxPlugin } from '../src/plugin';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx scripts/test-with-docx.ts <docx-file-path>');
    process.exit(1);
  }

  const plugin = new DocxPlugin();
  await plugin.init();

  const result = await plugin.toMarkdown(filePath);
  console.log('Markdown preview:\n', result.markdown.slice(0, 500));
  console.log('Mappings preview:', result.mapping.slice(0, 5));

  await plugin.dispose();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

**Step 3: 提交**

```bash
git add packages/plugins/plugin-docx/README.md packages/plugins/plugin-docx/scripts/test-with-docx.ts

git commit -m "docs(plugin-docx): add README and manual test script"
```

---

## Task 8: 集成到 Indexer

**Files:**
- Modify: `packages/indexer/package.json`
- Modify: `packages/indexer/tsconfig.json`
- Modify: `packages/indexer/src/indexer.ts`

**Step 1: 更新依赖**

```json
{
  "dependencies": {
    "@agent-fs/plugin-docx": "workspace:*"
  }
}
```

**Step 2: 更新 `tsconfig.json` 引用**

```json
{
  "references": [
    { "path": "../plugins/plugin-docx" }
  ]
}
```

**Step 3: 注册插件**

```typescript
import { DocxPlugin } from '@agent-fs/plugin-docx';

// 注册默认插件
this.pluginManager.register(new MarkdownPlugin());
this.pluginManager.register(new PDFPlugin());
this.pluginManager.register(new DocxPlugin());
```

**Step 4: 运行构建**

Run: `pnpm --filter @agent-fs/indexer build`

Expected: BUILD SUCCESS

**Step 5: 提交**

```bash
git add packages/indexer/package.json packages/indexer/tsconfig.json packages/indexer/src/indexer.ts

git commit -m "feat(indexer): register docx plugin"
```

---

## Task 9: 端到端手动验证

**Files:**
- Modify: `packages/plugins/plugin-docx/package.json`

**Step 1: 构建并发布 DocxConverter**

Run: `pnpm --filter @agent-fs/plugin-docx build:dotnet`

Expected: 生成 `packages/plugins/plugin-docx/dotnet/DocxConverter/bin/Release/net8.0/publish/DocxConverter.dll`

**Step 2: 手动调用脚本**

Run: `npx tsx packages/plugins/plugin-docx/scripts/test-with-docx.ts /path/to/sample.docx`

Expected: 输出 Markdown 预览与映射数组

**Step 3: 提交（若有脚本调整）**

```bash
git add packages/plugins/plugin-docx/package.json

git commit -m "chore(plugin-docx): record docx converter publish step"
```

---

## 完成检查清单

- [ ] `pnpm --filter @agent-fs/plugin-docx test`
- [ ] `pnpm --filter @agent-fs/plugin-docx build:dotnet`
- [ ] `pnpm --filter @agent-fs/indexer build`
- [ ] 手动脚本可跑通 `.docx` 样例
- [ ] `DocxPlugin` 在 Indexer 中注册成功

---

## 执行记录

- 2026-02-04：完成 Task 1-9，实现 DocxService、DocxPlugin、DocxConverter 与 Indexer 集成。
- 2026-02-04：`pnpm --filter @agent-fs/plugin-docx build:dotnet` 通过；`pnpm --filter @agent-fs/indexer build` 通过。
- 2026-02-04：手动脚本验证未执行（缺少可用 `.docx` 样例）。
- 2026-02-04：补充 DocxConverter 测试覆盖 `w:jc` 的 `start/end` 值，修复 NPOI 解析异常；`dotnet test ...DocxConverter.Tests.csproj` 通过。
- 2026-02-04：`pnpm --filter @agent-fs/plugin-docx build:dotnet` 通过；`npx tsx packages/plugins/plugin-docx/scripts/test-with-docx.ts /Users/weidwonder/projects/agent_fs/test-data/sub_folder/sub_folder/test_doc.doc` 通过。

# Excel 插件实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 xls/xlsx 文件索引支持，使用 TypeScript 插件 + C# CLI 工具架构

**Architecture:** TypeScript ExcelPlugin 通过 JSON-RPC over stdio 调用 C# excel-converter 工具。C# 负责 Excel 解析和 Markdown 生成，TypeScript 负责组装最终输出和位置映射。

**Tech Stack:** TypeScript, C# .NET 8, EPPlus, NPOI, JSON-RPC

---

## 任务概览

| 任务 | 描述 | 预计文件数 |
|------|------|-----------|
| Task 1 | 创建 C# 项目结构 | 4 |
| Task 2 | 实现 C# Models | 3 |
| Task 3 | 复制核心服务 | 6 |
| Task 4 | 实现 ExcelToMarkdownService | 2 |
| Task 5 | 实现 JsonRpcServer | 2 |
| Task 6 | C# 入口和测试 | 2 |
| Task 7 | 创建 TypeScript 项目 | 3 |
| Task 8 | 实现 ConverterClient | 2 |
| Task 9 | 实现 ExcelPlugin | 2 |
| Task 10 | 集成测试 | 1 |

---

## Task 1: 创建 C# 项目结构

**Files:**
- Create: `packages/plugins/plugin-excel/dotnet/excel-converter/ExcelConverter.csproj`
- Create: `packages/plugins/plugin-excel/dotnet/excel-converter/Services/.gitkeep`
- Create: `packages/plugins/plugin-excel/dotnet/excel-converter/Models/.gitkeep`
- Create: `packages/plugins/plugin-excel/dotnet/excel-converter/Analyzers/.gitkeep`

**Step 1: 创建目录结构**

```bash
mkdir -p packages/plugins/plugin-excel/dotnet/excel-converter/Services
mkdir -p packages/plugins/plugin-excel/dotnet/excel-converter/Models
mkdir -p packages/plugins/plugin-excel/dotnet/excel-converter/Analyzers
```

**Step 2: 创建项目文件**

Create `packages/plugins/plugin-excel/dotnet/excel-converter/ExcelConverter.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <PublishSingleFile>true</PublishSingleFile>
    <SelfContained>false</SelfContained>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="EPPlus" Version="8.0.0" />
    <PackageReference Include="NPOI" Version="2.7.2" />
    <PackageReference Include="System.Text.Json" Version="8.0.5" />
  </ItemGroup>

</Project>
```

**Step 3: 验证项目创建**

```bash
cd packages/plugins/plugin-excel/dotnet/excel-converter
dotnet restore
```

Expected: 成功还原依赖

**Step 4: Commit**

```bash
git add packages/plugins/plugin-excel/
git commit -m "chore: scaffold C# excel-converter project structure"
```

---

## Task 2: 实现 C# Models

**Files:**
- Create: `packages/plugins/plugin-excel/dotnet/excel-converter/Models/ConvertRequest.cs`
- Create: `packages/plugins/plugin-excel/dotnet/excel-converter/Models/ConvertResponse.cs`
- Create: `packages/plugins/plugin-excel/dotnet/excel-converter/Models/ExcelModels.cs`

**Step 1: 创建 ConvertRequest**

Create `packages/plugins/plugin-excel/dotnet/excel-converter/Models/ConvertRequest.cs`:

```csharp
namespace ExcelConverter.Models;

public class ConvertRequest
{
    public string FilePath { get; set; } = string.Empty;
}
```

**Step 2: 创建 ConvertResponse**

Create `packages/plugins/plugin-excel/dotnet/excel-converter/Models/ConvertResponse.cs`:

```csharp
namespace ExcelConverter.Models;

public class ConvertResponse
{
    public List<SheetResult> Sheets { get; set; } = new();
}

public class SheetResult
{
    public string Name { get; set; } = string.Empty;
    public int Index { get; set; }
    public List<RegionResult> Regions { get; set; } = new();
}

public class RegionResult
{
    public string Range { get; set; } = string.Empty;
    public List<string> Tables { get; set; } = new();
    public string Markdown { get; set; } = string.Empty;
}
```

**Step 3: 创建 ExcelModels（从 excel_mcp_dotnet 复制并简化）**

Create `packages/plugins/plugin-excel/dotnet/excel-converter/Models/ExcelModels.cs`:

```csharp
namespace ExcelConverter.Models;

public class RegionInfo
{
    public int StartRow { get; set; }
    public int StartColumn { get; set; }
    public int EndRow { get; set; }
    public int EndColumn { get; set; }
    public string RangeString { get; set; } = string.Empty;

    public int RowCount => EndRow - StartRow + 1;
    public int ColumnCount => EndColumn - StartColumn + 1;
    public int TotalCells => RowCount * ColumnCount;
}

public class CellInfo
{
    public int Row { get; set; }
    public int Column { get; set; }
    public string Address { get; set; } = string.Empty;
    public object? Value { get; set; }
    public string? Formula { get; set; }
    public bool IsMerged { get; set; }
    public bool IsMergeMaster { get; set; }
    public string? MergeType { get; set; }
    public CellStyle? Style { get; set; }
    public CellDataType DataType { get; set; }
}

public class CellStyle
{
    public BorderInfo? Border { get; set; }
    public string? BackgroundColor { get; set; }
    public string? NumberFormat { get; set; }
}

public class BorderInfo
{
    public bool Top { get; set; }
    public bool Bottom { get; set; }
    public bool Left { get; set; }
    public bool Right { get; set; }
    public bool HasAny => Top || Bottom || Left || Right;
    public bool IsFullBorder => Top && Bottom && Left && Right;
}

public enum CellDataType
{
    Empty,
    Text,
    Number,
    Date,
    Boolean,
    Formula
}

public class TableInfo
{
    public string Range { get; set; } = string.Empty;
    public string? RegionRange { get; set; }
}
```

**Step 4: 验证编译**

```bash
cd packages/plugins/plugin-excel/dotnet/excel-converter
dotnet build
```

Expected: Build succeeded

**Step 5: Commit**

```bash
git add packages/plugins/plugin-excel/dotnet/excel-converter/Models/
git commit -m "feat(excel-converter): add C# models"
```

---

## Task 3: 复制核心服务

**Files:**
- Create: `packages/plugins/plugin-excel/dotnet/excel-converter/Services/IExcelLoaderService.cs`
- Create: `packages/plugins/plugin-excel/dotnet/excel-converter/Services/ExcelLoaderService.cs`
- Create: `packages/plugins/plugin-excel/dotnet/excel-converter/Services/IXlsConverterService.cs`
- Create: `packages/plugins/plugin-excel/dotnet/excel-converter/Services/XlsConverterService.cs`
- Create: `packages/plugins/plugin-excel/dotnet/excel-converter/Services/IRegionManagerService.cs`
- Create: `packages/plugins/plugin-excel/dotnet/excel-converter/Services/RegionManagerService.cs`

**Step 1: 创建 IExcelLoaderService**

Create `packages/plugins/plugin-excel/dotnet/excel-converter/Services/IExcelLoaderService.cs`:

```csharp
using ExcelConverter.Models;

namespace ExcelConverter.Services;

public interface IExcelLoaderService : IDisposable
{
    void Open(string filePath);
    void Close();
    List<string> GetSheetNames();
    RegionInfo GetSheetBounds(string? sheetName = null);
    CellInfo GetCellInfo(int row, int column, string? sheetName = null);
    bool IsRowHidden(int row, string? sheetName = null);
    bool IsColumnHidden(int column, string? sheetName = null);
}
```

**Step 2: 创建 ExcelLoaderService**

Create `packages/plugins/plugin-excel/dotnet/excel-converter/Services/ExcelLoaderService.cs`:

从 `/Users/weidwonder/projects/MCPs/excel_mcp_dotnet/src/ExcelMcp.Core/Services/ExcelLoaderService.cs` 复制，修改命名空间为 `ExcelConverter.Services`，引用 `ExcelConverter.Models`。

保留以下方法：
- `Open`, `Close`, `GetSheetNames`, `GetSheetBounds`
- `GetCellInfo`, `GetCellValue`, `GetCellStyle`
- `IsRowHidden`, `IsColumnHidden`, `IsCellEmpty`
- `DetermineCellDataType`

删除不需要的方法：
- `GetCellFormula`, `IsMergedCell`, `GetMergedCellMaster`
- `GetRangeCells`, `GetRangeValues`, `GetCellDataType`

**Step 3: 创建 IXlsConverterService 和 XlsConverterService**

从 excel_mcp_dotnet 复制，修改命名空间。

**Step 4: 创建 IRegionManagerService**

Create `packages/plugins/plugin-excel/dotnet/excel-converter/Services/IRegionManagerService.cs`:

```csharp
using ExcelConverter.Models;

namespace ExcelConverter.Services;

public interface IRegionManagerService
{
    RegionInfo ParseRange(string rangeString);
    string ToRangeString(RegionInfo region);
    List<RegionInfo> SplitWorksheet(IExcelLoaderService loader, string? sheetName = null, int minEmptyRows = 2, int minEmptyCols = 2);
    string GetColumnLetter(int columnNumber);
    int GetColumnNumber(string columnLetter);
    (int row, int column) ParseCellAddress(string cellAddress);
    string ToCellAddress(int row, int column);
}
```

**Step 5: 创建 RegionManagerService**

从 excel_mcp_dotnet 复制 RegionManagerService.cs，修改命名空间。

**Step 6: 验证编译**

```bash
cd packages/plugins/plugin-excel/dotnet/excel-converter
dotnet build
```

Expected: Build succeeded

**Step 7: Commit**

```bash
git add packages/plugins/plugin-excel/dotnet/excel-converter/Services/
git commit -m "feat(excel-converter): add core services from excel_mcp_dotnet"
```

---

## Task 4: 实现 ExcelToMarkdownService

**Files:**
- Create: `packages/plugins/plugin-excel/dotnet/excel-converter/Analyzers/TableDetector.cs`
- Create: `packages/plugins/plugin-excel/dotnet/excel-converter/Services/ExcelToMarkdownService.cs`

**Step 1: 复制 TableDetector**

从 excel_mcp_dotnet 复制 TableDetector.cs，修改命名空间为 `ExcelConverter.Analyzers`。

**Step 2: 创建 ExcelToMarkdownService**

Create `packages/plugins/plugin-excel/dotnet/excel-converter/Services/ExcelToMarkdownService.cs`:

```csharp
using System.Text;
using ExcelConverter.Analyzers;
using ExcelConverter.Models;

namespace ExcelConverter.Services;

public class ExcelToMarkdownService
{
    private readonly IExcelLoaderService _loader;
    private readonly IRegionManagerService _regionManager;
    private readonly TableDetector _tableDetector;

    public ExcelToMarkdownService(
        IExcelLoaderService loader,
        IRegionManagerService regionManager)
    {
        _loader = loader;
        _regionManager = regionManager;
        _tableDetector = new TableDetector(regionManager);
    }

    public ConvertResponse Convert(string filePath)
    {
        _loader.Open(filePath);
        try
        {
            var response = new ConvertResponse();
            var sheetNames = _loader.GetSheetNames();

            for (int i = 0; i < sheetNames.Count; i++)
            {
                var sheetName = sheetNames[i];
                var sheetResult = new SheetResult
                {
                    Name = sheetName,
                    Index = i
                };

                // 分割区域
                var regions = _regionManager.SplitWorksheet(_loader, sheetName);

                foreach (var region in regions)
                {
                    // 检测表格
                    var tableResult = _tableDetector.DetectTables(_loader, sheetName, "border", region, false);
                    var tables = tableResult.Tables.Select(t => t.Range).ToList();

                    // 生成 Markdown
                    var markdown = GenerateMarkdown(region, sheetName);

                    sheetResult.Regions.Add(new RegionResult
                    {
                        Range = _regionManager.ToRangeString(region),
                        Tables = tables,
                        Markdown = markdown
                    });
                }

                response.Sheets.Add(sheetResult);
            }

            return response;
        }
        finally
        {
            _loader.Close();
        }
    }

    private string GenerateMarkdown(RegionInfo region, string sheetName)
    {
        var sb = new StringBuilder();

        // 列标题行
        sb.Append("|   |");
        for (int col = region.StartColumn; col <= region.EndColumn; col++)
        {
            var colLetter = _regionManager.GetColumnLetter(col);
            sb.Append($" {colLetter} |");
        }
        sb.AppendLine();

        // 分隔行
        sb.Append("|---|");
        for (int col = region.StartColumn; col <= region.EndColumn; col++)
        {
            sb.Append("---|");
        }
        sb.AppendLine();

        // 数据行
        for (int row = region.StartRow; row <= region.EndRow; row++)
        {
            sb.Append($"| {row} |");
            for (int col = region.StartColumn; col <= region.EndColumn; col++)
            {
                var cellInfo = _loader.GetCellInfo(row, col, sheetName);
                var cellText = FormatCellValue(cellInfo);
                sb.Append($" {cellText} |");
            }
            sb.AppendLine();
        }

        return sb.ToString();
    }

    private string FormatCellValue(CellInfo cellInfo)
    {
        // 处理合并单元格标记
        if (cellInfo.IsMerged && !cellInfo.IsMergeMaster)
        {
            return cellInfo.MergeType == "horizontal" ? "<" : "^";
        }

        if (cellInfo.Value == null)
            return string.Empty;

        var value = EscapeMarkdown(cellInfo.Value.ToString() ?? string.Empty);

        // 添加公式信息
        if (!string.IsNullOrEmpty(cellInfo.Formula))
        {
            var formula = EscapeMarkdown(cellInfo.Formula);
            return string.IsNullOrEmpty(value)
                ? $"[未计算]{{fx=\"{formula}\"}}"
                : $"{value}{{fx=\"{formula}\"}}";
        }

        return value;
    }

    private string EscapeMarkdown(string text)
    {
        return text
            .Replace("\\", "\\\\")
            .Replace("|", "\\|")
            .Replace("<", "\\<")
            .Replace("^", "\\^");
    }
}
```

**Step 3: 验证编译**

```bash
cd packages/plugins/plugin-excel/dotnet/excel-converter
dotnet build
```

Expected: Build succeeded

**Step 4: Commit**

```bash
git add packages/plugins/plugin-excel/dotnet/excel-converter/
git commit -m "feat(excel-converter): implement ExcelToMarkdownService"
```

---

## Task 5: 实现 JsonRpcServer

**Files:**
- Create: `packages/plugins/plugin-excel/dotnet/excel-converter/JsonRpc/JsonRpcMessage.cs`
- Create: `packages/plugins/plugin-excel/dotnet/excel-converter/JsonRpc/JsonRpcServer.cs`

**Step 1: 创建 JsonRpcMessage**

Create `packages/plugins/plugin-excel/dotnet/excel-converter/JsonRpc/JsonRpcMessage.cs`:

```csharp
using System.Text.Json.Serialization;

namespace ExcelConverter.JsonRpc;

public class JsonRpcRequest
{
    [JsonPropertyName("jsonrpc")]
    public string JsonRpc { get; set; } = "2.0";

    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("method")]
    public string Method { get; set; } = string.Empty;

    [JsonPropertyName("params")]
    public JsonElement? Params { get; set; }
}

public class JsonRpcResponse
{
    [JsonPropertyName("jsonrpc")]
    public string JsonRpc { get; set; } = "2.0";

    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("result")]
    public object? Result { get; set; }

    [JsonPropertyName("error")]
    public JsonRpcError? Error { get; set; }
}

public class JsonRpcError
{
    [JsonPropertyName("code")]
    public int Code { get; set; }

    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;
}
```

**Step 2: 创建 JsonRpcServer**

Create `packages/plugins/plugin-excel/dotnet/excel-converter/JsonRpc/JsonRpcServer.cs`:

```csharp
using System.Text.Json;
using ExcelConverter.Models;
using ExcelConverter.Services;

namespace ExcelConverter.JsonRpc;

public class JsonRpcServer
{
    private readonly ExcelToMarkdownService _converter;
    private readonly JsonSerializerOptions _jsonOptions;
    private bool _running = true;

    public JsonRpcServer()
    {
        var loader = new ExcelLoaderService(new XlsConverterService());
        var regionManager = new RegionManagerService();
        _converter = new ExcelToMarkdownService(loader, regionManager);

        _jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = false
        };
    }

    public async Task RunAsync()
    {
        using var reader = new StreamReader(Console.OpenStandardInput());

        while (_running)
        {
            var line = await reader.ReadLineAsync();
            if (line == null) break;

            var response = ProcessRequest(line);
            Console.WriteLine(JsonSerializer.Serialize(response, _jsonOptions));
        }
    }

    private JsonRpcResponse ProcessRequest(string requestJson)
    {
        JsonRpcRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<JsonRpcRequest>(requestJson, _jsonOptions);
        }
        catch (Exception ex)
        {
            return new JsonRpcResponse
            {
                Id = 0,
                Error = new JsonRpcError { Code = -32700, Message = $"Parse error: {ex.Message}" }
            };
        }

        if (request == null)
        {
            return new JsonRpcResponse
            {
                Id = 0,
                Error = new JsonRpcError { Code = -32600, Message = "Invalid request" }
            };
        }

        try
        {
            return request.Method switch
            {
                "convert" => HandleConvert(request),
                "ping" => HandlePing(request),
                "shutdown" => HandleShutdown(request),
                _ => new JsonRpcResponse
                {
                    Id = request.Id,
                    Error = new JsonRpcError { Code = -32601, Message = $"Method not found: {request.Method}" }
                }
            };
        }
        catch (Exception ex)
        {
            return new JsonRpcResponse
            {
                Id = request.Id,
                Error = new JsonRpcError { Code = -32000, Message = ex.Message }
            };
        }
    }

    private JsonRpcResponse HandleConvert(JsonRpcRequest request)
    {
        var paramsJson = request.Params?.GetRawText() ?? "{}";
        var convertRequest = JsonSerializer.Deserialize<ConvertRequest>(paramsJson, _jsonOptions);

        if (convertRequest == null || string.IsNullOrEmpty(convertRequest.FilePath))
        {
            return new JsonRpcResponse
            {
                Id = request.Id,
                Error = new JsonRpcError { Code = -32602, Message = "Invalid params: filePath required" }
            };
        }

        var result = _converter.Convert(convertRequest.FilePath);
        return new JsonRpcResponse { Id = request.Id, Result = result };
    }

    private JsonRpcResponse HandlePing(JsonRpcRequest request)
    {
        return new JsonRpcResponse { Id = request.Id, Result = new { status = "ok" } };
    }

    private JsonRpcResponse HandleShutdown(JsonRpcRequest request)
    {
        _running = false;
        return new JsonRpcResponse { Id = request.Id, Result = new { status = "shutting down" } };
    }
}
```

**Step 3: 添加 using 语句修复**

在 JsonRpcMessage.cs 顶部添加：

```csharp
using System.Text.Json;
```

**Step 4: 验证编译**

```bash
cd packages/plugins/plugin-excel/dotnet/excel-converter
dotnet build
```

Expected: Build succeeded

**Step 5: Commit**

```bash
git add packages/plugins/plugin-excel/dotnet/excel-converter/JsonRpc/
git commit -m "feat(excel-converter): implement JSON-RPC server"
```

---

## Task 6: C# 入口和测试

**Files:**
- Create: `packages/plugins/plugin-excel/dotnet/excel-converter/Program.cs`
- Create: `packages/plugins/plugin-excel/dotnet/test-convert.sh`

**Step 1: 创建 Program.cs**

Create `packages/plugins/plugin-excel/dotnet/excel-converter/Program.cs`:

```csharp
using ExcelConverter.JsonRpc;
using OfficeOpenXml;

// EPPlus 许可证设置
ExcelPackage.License.SetNonCommercialPersonal("agent-fs");

// 启动 JSON-RPC 服务器
var server = new JsonRpcServer();
await server.RunAsync();
```

**Step 2: 验证编译和运行**

```bash
cd packages/plugins/plugin-excel/dotnet/excel-converter
dotnet build
echo '{"jsonrpc":"2.0","id":1,"method":"ping"}' | dotnet run
```

Expected: `{"jsonrpc":"2.0","id":1,"result":{"status":"ok"}}`

**Step 3: 创建测试脚本**

Create `packages/plugins/plugin-excel/dotnet/test-convert.sh`:

```bash
#!/bin/bash
# 测试 excel-converter

cd "$(dirname "$0")/excel-converter"

# 测试 ping
echo "Testing ping..."
echo '{"jsonrpc":"2.0","id":1,"method":"ping"}' | dotnet run

# 测试 convert（需要测试文件）
# echo '{"jsonrpc":"2.0","id":2,"method":"convert","params":{"filePath":"/path/to/test.xlsx"}}' | dotnet run
```

**Step 4: Commit**

```bash
git add packages/plugins/plugin-excel/dotnet/
git commit -m "feat(excel-converter): add entry point and test script"
```

---

## Task 7: 创建 TypeScript 项目

**Files:**
- Create: `packages/plugins/plugin-excel/package.json`
- Create: `packages/plugins/plugin-excel/tsconfig.json`
- Create: `packages/plugins/plugin-excel/src/index.ts`

**Step 1: 创建 package.json**

Create `packages/plugins/plugin-excel/package.json`:

```json
{
  "name": "@agent-fs/plugin-excel",
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
  "files": [
    "dist",
    "dotnet"
  ],
  "scripts": {
    "build": "tsc",
    "build:dotnet": "cd dotnet/excel-converter && dotnet publish -c Release -o ../../dist/dotnet",
    "build:all": "pnpm build:dotnet && pnpm build",
    "clean": "rm -rf dist",
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

**Step 2: 创建 tsconfig.json**

Create `packages/plugins/plugin-excel/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: 创建 index.ts**

Create `packages/plugins/plugin-excel/src/index.ts`:

```typescript
export { ExcelPlugin, createExcelPlugin } from './plugin';
export type { ExcelPluginOptions } from './plugin';
```

**Step 4: 安装依赖**

```bash
cd packages/plugins/plugin-excel
pnpm install
```

**Step 5: Commit**

```bash
git add packages/plugins/plugin-excel/
git commit -m "chore: scaffold TypeScript plugin-excel project"
```

---

## Task 8: 实现 ConverterClient

**Files:**
- Create: `packages/plugins/plugin-excel/src/types.ts`
- Create: `packages/plugins/plugin-excel/src/converter-client.ts`

**Step 1: 创建 types.ts**

Create `packages/plugins/plugin-excel/src/types.ts`:

```typescript
export interface ConvertResponse {
  sheets: SheetResult[];
}

export interface SheetResult {
  name: string;
  index: number;
  regions: RegionResult[];
}

export interface RegionResult {
  range: string;
  tables: string[];
  markdown: string;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}
```

**Step 2: 创建 converter-client.ts**

Create `packages/plugins/plugin-excel/src/converter-client.ts`:

```typescript
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConvertResponse, JsonRpcRequest, JsonRpcResponse } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ConverterClientOptions {
  dotnetPath?: string;
}

export class ConverterClient {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private options: ConverterClientOptions;

  constructor(options: ConverterClientOptions = {}) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.process) return;

    const converterPath = this.options.dotnetPath ??
      join(__dirname, '..', 'dotnet', 'excel-converter');

    this.process = spawn('dotnet', ['run', '--project', converterPath], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    this.readline = createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity
    });

    this.readline.on('line', (line) => {
      this.handleResponse(line);
    });

    this.process.on('exit', () => {
      this.process = null;
      this.readline = null;
    });

    // 等待进程启动
    await this.ping();
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    try {
      await this.send('shutdown', {});
    } catch {
      // ignore
    }

    this.process.kill();
    this.process = null;
    this.readline = null;
  }

  async convert(filePath: string): Promise<ConvertResponse> {
    const result = await this.send<ConvertResponse>('convert', { filePath });
    return result;
  }

  async ping(): Promise<void> {
    await this.send('ping', {});
  }

  private async send<T>(method: string, params: unknown): Promise<T> {
    if (!this.process || !this.process.stdin) {
      throw new Error('Converter process not running');
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.process!.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  private handleResponse(line: string): void {
    try {
      const response: JsonRpcResponse = JSON.parse(line);
      const pending = this.pendingRequests.get(response.id);

      if (pending) {
        this.pendingRequests.delete(response.id);

        if (response.error) {
          pending.reject(new Error(response.error.message));
        } else {
          pending.resolve(response.result);
        }
      }
    } catch {
      // ignore parse errors
    }
  }
}
```

**Step 3: 验证编译**

```bash
cd packages/plugins/plugin-excel
pnpm build
```

Expected: Build succeeded

**Step 4: Commit**

```bash
git add packages/plugins/plugin-excel/src/
git commit -m "feat(plugin-excel): implement ConverterClient"
```

---

## Task 9: 实现 ExcelPlugin

**Files:**
- Create: `packages/plugins/plugin-excel/src/plugin.ts`
- Modify: `packages/plugins/plugin-excel/src/index.ts`

**Step 1: 创建 plugin.ts**

Create `packages/plugins/plugin-excel/src/plugin.ts`:

```typescript
import type {
  DocumentPlugin,
  DocumentConversionResult,
  PositionMapping,
  LocatorInfo,
} from '@agent-fs/core';
import { ConverterClient, type ConverterClientOptions } from './converter-client';

export interface ExcelPluginOptions {
  converter?: ConverterClientOptions;
}

export class ExcelPlugin implements DocumentPlugin {
  readonly name = 'excel';
  readonly supportedExtensions = ['xls', 'xlsx'];

  private client: ConverterClient | null = null;
  private options: ExcelPluginOptions;

  constructor(options: ExcelPluginOptions = {}) {
    this.options = options;
  }

  async init(): Promise<void> {
    this.client = new ConverterClient(this.options.converter);
    await this.client.start();
  }

  async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
    if (!this.client) {
      throw new Error('Plugin not initialized. Call init() first.');
    }

    const response = await this.client.convert(filePath);

    let markdown = '';
    const mapping: PositionMapping[] = [];
    let currentLine = 1;

    for (const sheet of response.sheets) {
      // Sheet 标题
      markdown += `## Sheet: ${sheet.name}\n\n`;
      currentLine += 2;

      for (const region of sheet.regions) {
        // 区域标题
        markdown += `### 区域 ${region.range}\n`;
        currentLine += 1;

        // 表格标注
        if (region.tables.length > 0) {
          markdown += `Tables: ${region.tables.join(', ')}\n\n`;
        } else {
          markdown += `Tables: (none)\n\n`;
        }
        currentLine += 2;

        // 记录映射起始行
        const regionStartLine = currentLine;

        // 区域内容
        const regionLines = region.markdown.split('\n');
        markdown += region.markdown;
        if (!region.markdown.endsWith('\n')) {
          markdown += '\n';
        }
        markdown += '\n';

        // 记录映射
        mapping.push({
          markdownRange: {
            startLine: regionStartLine,
            endLine: regionStartLine + regionLines.length - 1
          },
          originalLocator: `sheet:${sheet.name}/range:${region.range}`
        });

        currentLine += regionLines.length + 1;
      }
    }

    return { markdown, mapping };
  }

  parseLocator(locator: string): LocatorInfo {
    const match = locator.match(/^sheet:([^/]+)\/range:(.+)$/);
    if (!match) {
      return { displayText: locator };
    }

    const [, sheetName, range] = match;
    return {
      displayText: `工作表 "${sheetName}" - 区域 ${range}`,
      jumpInfo: { sheet: sheetName, range }
    };
  }

  async dispose(): Promise<void> {
    await this.client?.stop();
    this.client = null;
  }
}

export function createExcelPlugin(options?: ExcelPluginOptions): ExcelPlugin {
  return new ExcelPlugin(options);
}
```

**Step 2: 验证编译**

```bash
cd packages/plugins/plugin-excel
pnpm build
```

Expected: Build succeeded

**Step 3: Commit**

```bash
git add packages/plugins/plugin-excel/src/
git commit -m "feat(plugin-excel): implement ExcelPlugin"
```

---

## Task 10: 集成测试

**Files:**
- Create: `packages/plugins/plugin-excel/src/plugin.test.ts`

**Step 1: 创建测试文件**

Create `packages/plugins/plugin-excel/src/plugin.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ExcelPlugin } from './plugin';

describe('ExcelPlugin', () => {
  const plugin = new ExcelPlugin();

  it('should have correct name and extensions', () => {
    expect(plugin.name).toBe('excel');
    expect(plugin.supportedExtensions).toEqual(['xls', 'xlsx']);
  });

  it('should parse locator correctly', () => {
    const info = plugin.parseLocator('sheet:销售数据/range:A1:E25');

    expect(info.displayText).toBe('工作表 "销售数据" - 区域 A1:E25');
    expect(info.jumpInfo).toEqual({ sheet: '销售数据', range: 'A1:E25' });
  });

  it('should handle invalid locator', () => {
    const info = plugin.parseLocator('invalid');

    expect(info.displayText).toBe('invalid');
    expect(info.jumpInfo).toBeUndefined();
  });
});

// 集成测试（需要 .NET 环境）
describe.skip('ExcelPlugin Integration', () => {
  const plugin = new ExcelPlugin();

  beforeAll(async () => {
    await plugin.init();
  });

  afterAll(async () => {
    await plugin.dispose();
  });

  it('should convert xlsx file', async () => {
    // 需要测试文件
    const result = await plugin.toMarkdown('/path/to/test.xlsx');

    expect(result.markdown).toBeTruthy();
    expect(result.mapping.length).toBeGreaterThan(0);
  });
});
```

**Step 2: 运行测试**

```bash
cd packages/plugins/plugin-excel
pnpm test
```

Expected: 单元测试通过

**Step 3: Commit**

```bash
git add packages/plugins/plugin-excel/src/plugin.test.ts
git commit -m "test(plugin-excel): add unit tests"
```

---

## 完成检查清单

- [ ] C# 项目可编译
- [ ] JSON-RPC ping 正常响应
- [ ] TypeScript 项目可编译
- [ ] 单元测试通过
- [ ] 集成测试（需要测试 Excel 文件）

## 后续工作

1. 添加测试 Excel 文件
2. 完善错误处理
3. 添加进程重启机制
4. 发布 C# 可执行文件（避免每次 dotnet run）
5. 注册到 Indexer 的 PluginManager

# Excel 插件设计文档

> 为 Agent FS 添加 xls/xlsx 文件索引支持

## 概述

本设计实现一个 Excel 文档处理插件，支持 `.xls` 和 `.xlsx` 两种格式的索引。采用 TypeScript 插件 + C# CLI 工具的架构，通过 JSON-RPC 协议通信。

## 设计决策

| 项 | 决策 | 理由 |
|-----|------|------|
| 架构 | TypeScript 插件 + C# CLI | C# 生态的 Excel 处理库更成熟 |
| 启动方式 | 内嵌启动 | Indexer 自动管理进程，用户无感知 |
| 通信协议 | stdio + JSON-RPC | 无需端口，简单可靠 |
| 输出格式 | 结构化 Markdown | 保留工作表、区域、表格层次 |
| 定位符 | `sheet:名称/range:范围` | 精确到单元格范围 |

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Indexer (TypeScript)                    │
│  ┌─────────────────┐    ┌────────────────────────────────┐  │
│  │  PluginManager  │───►│  ExcelPlugin (TypeScript)      │  │
│  └─────────────────┘    │    - 实现 DocumentPlugin 接口  │  │
│                         │    - 管理 C# 进程生命周期       │  │
│                         │    - JSON-RPC 通信封装          │  │
│                         └──────────────┬─────────────────┘  │
└────────────────────────────────────────┼────────────────────┘
                                         │ stdio (JSON-RPC)
                                         ▼
┌─────────────────────────────────────────────────────────────┐
│              excel-converter (C# .NET 8)                     │
│  ┌─────────────────┐    ┌────────────────────────────────┐  │
│  │  JsonRpcServer  │───►│  ExcelToMarkdownService        │  │
│  │  (stdin/stdout) │    │    - 读取 xls/xlsx             │  │
│  └─────────────────┘    │    - 分割区域                   │  │
│                         │    - 检测表格边界               │  │
│                         │    - 生成 Markdown              │  │
│                         └────────────────────────────────┘  │
│  依赖: EPPlus (xlsx) + NPOI (xls→xlsx 转换)                 │
└─────────────────────────────────────────────────────────────┘
```

## 数据流

```
Excel 文件
    ↓
C# (加载 → 分割区域 → 检测表格 → 生成 Markdown)
    ↓ JSON-RPC
TypeScript (组装最终 Markdown + PositionMapping)
    ↓
Indexer (切分 → 向量化 → 存储)
```

## 转换策略

### 层次结构

```
工作表 → 区域（空行分隔）→ 区域内可能有表格
```

- **区域**：由空行分隔的数据块（使用 RegionManager.SplitWorksheet）
- **表格**：区域内通过 detect_tables 识别的表格边界
- **输出**：整个区域的完整内容（非压缩模式），同时标注表格位置

### Markdown 输出格式

```markdown
## Sheet: 销售数据

### 区域 A1:E25
Tables: A5:E20

|   | A | B | C | D | E |
|---|---|---|---|---|---|
| 1 | 2024年度报告 | | | | |
| 2 | 制表日期: 2024-01-15 | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | 产品 | Q1 | Q2 | Q3 | Q4 |
| 6 | 产品A | 100 | 120 | 130 | 140 |
...
| 22 | 备注: | 数据来源于... | | | |

### 区域 A30:C40
Tables: (none)

|   | A | B | C |
|---|---|---|---|
...
```

### 定位符设计

格式：`sheet:工作表名/range:单元格范围`

示例：
- `sheet:销售数据/range:A1:E25`
- `sheet:Sheet1/range:A1:C10`

解析后的显示文本：`工作表 "销售数据" - 区域 A1:E25`

## JSON-RPC 协议

### 请求格式

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "convert",
  "params": {
    "filePath": "/path/to/file.xlsx"
  }
}
```

### 响应格式

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "sheets": [
      {
        "name": "销售数据",
        "index": 0,
        "regions": [
          {
            "range": "A1:E25",
            "tables": ["A5:E20"],
            "markdown": "|   | A | B | C | D | E |\n|---|---|---|---|---|---|\n..."
          },
          {
            "range": "A30:C40",
            "tables": [],
            "markdown": "|   | A | B | C |\n..."
          }
        ]
      }
    ]
  }
}
```

### 支持的方法

| 方法 | 说明 |
|------|------|
| `convert` | 转换 Excel 为 Markdown + Mapping |
| `ping` | 健康检查 |
| `shutdown` | 优雅关闭进程 |

### 错误响应

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32000,
    "message": "File not found: /path/to/file.xlsx"
  }
}
```

## 项目结构

### C# 项目

```
packages/plugins/plugin-excel/dotnet/excel-converter/
├── ExcelConverter.csproj      # .NET 8 项目文件
├── Program.cs                 # 入口，JSON-RPC 循环
├── Services/
│   ├── JsonRpcServer.cs       # stdin/stdout 通信
│   ├── ExcelToMarkdownService.cs  # 核心转换逻辑
│   └── XlsConverterService.cs     # .xls → .xlsx 转换
├── Models/
│   ├── ConvertRequest.cs
│   └── ConvertResponse.cs
└── publish/                   # 编译输出目录
    └── excel-converter        # 可执行文件
```

### TypeScript 插件

```
packages/plugins/plugin-excel/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts               # 导出
│   ├── plugin.ts              # ExcelPlugin 实现
│   ├── converter-client.ts    # JSON-RPC 客户端，管理 C# 进程
│   └── plugin.test.ts         # 测试
└── dotnet/                    # C# 项目（上述）
```

## C# 核心服务

### ExcelToMarkdownService

```csharp
public class ExcelToMarkdownService
{
    public ConvertResponse Convert(string filePath)
    {
        // 1. 打开文件（自动处理 xls → xlsx）
        _loader.Open(filePath);

        // 2. 遍历每个工作表
        foreach (var sheetName in _loader.GetSheetNames())
        {
            // 3. 分割区域（按空行分隔）
            var regions = _regionManager.SplitWorksheet(sheetName);

            foreach (var region in regions)
            {
                // 4. 检测表格边界
                var tables = _tableDetector.DetectTables(region);

                // 5. 生成 Markdown（非压缩模式）
                var markdown = _overviewGenerator.Generate(
                    region,
                    compressionMode: "none"
                );

                // 6. 收集结果
                results.Add(new RegionResult {
                    Range = region.RangeString,
                    Tables = tables.Select(t => t.Range).ToList(),
                    Markdown = markdown
                });
            }
        }

        return new ConvertResponse { Sheets = results };
    }
}
```

### 复用 excel_mcp_dotnet 的组件

| 组件 | 用途 |
|------|------|
| `ExcelLoaderService` | 加载 xlsx/xls 文件 |
| `XlsConverterService` | xls → xlsx 转换 |
| `RegionManagerService` | 区域分割、范围解析 |
| `TableDetector` | 表格边界检测 |
| `OverviewGenerator` | 生成 Markdown（非压缩模式）|

## TypeScript 插件

### ExcelPlugin

```typescript
export class ExcelPlugin implements DocumentPlugin {
  readonly name = 'excel';
  readonly supportedExtensions = ['xls', 'xlsx'];

  private client: ConverterClient | null = null;

  async init(): Promise<void> {
    // 启动 C# 进程
    this.client = new ConverterClient();
    await this.client.start();
  }

  async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
    // 1. 调用 C# 转换
    const response = await this.client.convert(filePath);

    // 2. 组装 Markdown
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

        // 区域内容
        const regionLines = region.markdown.split('\n').length;
        markdown += region.markdown + '\n\n';

        // 记录映射
        mapping.push({
          markdownRange: {
            startLine: currentLine,
            endLine: currentLine + regionLines - 1
          },
          originalLocator: `sheet:${sheet.name}/range:${region.range}`
        });

        currentLine += regionLines + 2;
      }
    }

    return { markdown, mapping };
  }

  parseLocator(locator: string): LocatorInfo {
    // 解析 sheet:名称/range:范围 格式
    const match = locator.match(/^sheet:([^/]+)\/range:(.+)$/);
    if (!match) return { displayText: locator };

    return {
      displayText: `工作表 "${match[1]}" - 区域 ${match[2]}`,
      jumpInfo: { sheet: match[1], range: match[2] }
    };
  }

  async dispose(): Promise<void> {
    await this.client?.shutdown();
  }
}
```

### ConverterClient

负责：
- spawn C# 进程
- JSON-RPC 请求/响应
- 进程生命周期管理

## 依赖

### C# (.NET 8)

- **EPPlus** (8.x): xlsx 读写
- **NPOI**: xls → xlsx 转换
- **System.Text.Json**: JSON 序列化

### TypeScript

- **@agent-fs/core**: 核心接口定义

## 参考资源

- [插件开发指南](../guides/plugin-development.md)
- [excel_mcp_dotnet 项目](https://github.com/weidwonder/excel_mcp_dotnet) - 复用其核心组件

---

**创建日期**: 2025-02-04

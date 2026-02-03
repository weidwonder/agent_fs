# plugin-docx 设计文档

> 支持 .doc/.docx 文件索引的 Agent FS 插件

## 概述

创建一个新插件 `plugin-docx`，通过包装 C# 程序实现对 Word 文档的索引支持。

## 设计决策

| 决策项 | 方案 |
|--------|------|
| 集成方式 | 常驻服务模式 |
| 代码策略 | 独立重写（不复用 doc_mcp） |
| 通信协议 | stdio 管道 + JSON |
| 映射粒度 | 标题用 heading，段落用 para |
| 表格处理 | 转换为 Markdown 格式 |
| 图片处理 | 占位符标记 `![image](img-{paraIdx}-{seq})` |
| .doc fallback | macOS/Linux 用 LibreOffice，Windows 用 Word COM |
| 发布形式 | 依赖 .NET 8 Runtime |

## 项目结构

```
packages/plugins/plugin-docx/
├── src/                          # TypeScript 插件
│   ├── plugin.ts                 # DocumentPlugin 实现
│   ├── service.ts                # 管理 C# 进程生命周期
│   ├── protocol.ts               # stdio 通信协议定义
│   └── index.ts
├── dotnet/                       # C# 程序
│   ├── DocxConverter/
│   │   ├── Program.cs            # 入口，stdio 循环
│   │   ├── Converter.cs          # 核心转换逻辑
│   │   ├── Models.cs             # 数据模型
│   │   └── DocxConverter.csproj
│   └── DocxConverter.sln
├── package.json
└── README.md
```

## 通信协议

### 请求格式（TypeScript → C#）

```json
{"id": "uuid", "method": "convert", "params": {"filePath": "/path/to/doc.docx"}}
```

### 响应格式（C# → TypeScript）

**成功响应：**
```json
{
  "id": "uuid",
  "success": true,
  "data": {
    "markdown": "# 标题\n\n段落内容...\n\n| 表格 | 内容 |\n...",
    "mappings": [
      {"startLine": 1, "endLine": 1, "locator": "heading:1:标题"},
      {"startLine": 3, "endLine": 5, "locator": "para:1"},
      {"startLine": 7, "endLine": 10, "locator": "para:2"}
    ]
  }
}
```

**错误响应：**
```json
{"id": "uuid", "success": false, "error": {"code": "FILE_NOT_FOUND", "message": "文件不存在"}}
```

### 协议约定

- 每条消息占一行（以 `\n` 分隔）
- 使用 JSON 序列化
- `id` 用于匹配请求/响应（支持并发）

## C# 转换逻辑

### 依赖库

- `NPOI` - 处理 .docx 文件
- `DocSharp.Binary` - 处理 .doc 文件（首选）

### .docx 处理流程

```
1. 使用 NPOI 读取文档
2. 遍历段落：
   - 检测样式（Heading1-9）→ 生成 # 标记 + heading 定位符
   - 普通段落 → 原文 + para 定位符
   - 表格 → 转 Markdown 表格格式
   - 图片 → 插入 ![image](img-{paraIdx}-{seq}) 占位符
3. 构建 mappings 数组（记录每段内容对应的行号范围）
4. 返回 JSON
```

### .doc 处理流程（含 fallback）

```
1. 尝试 DocSharp.Binary 直接解析
2. 如果失败，根据平台 fallback：
   - macOS/Linux → 调用 LibreOffice 命令行转换
     soffice --headless --convert-to docx --outdir /tmp file.doc
   - Windows → 通过 COM 接口调用 Microsoft Word
3. 将生成的 .docx 用 NPOI 处理
4. 清理临时文件
```

### 错误码

| 错误码 | 说明 |
|--------|------|
| `FILE_NOT_FOUND` | 文件不存在 |
| `UNSUPPORTED_FORMAT` | 不支持的格式 |
| `CONVERSION_FAILED` | DocSharp 解析失败 |
| `FALLBACK_UNAVAILABLE` | LibreOffice/Word 未安装 |
| `FALLBACK_FAILED` | Fallback 转换也失败 |

## 定位符格式

| 类型 | 格式 | 示例 |
|------|------|------|
| 标题 | `heading:{level}:{text}` | `heading:2:项目背景` |
| 段落 | `para:{index}` | `para:5` |
| 表格 | `table:{index}` | `table:0` |

## TypeScript 插件实现

### service.ts - 进程管理

```typescript
class DocxService {
  private process: ChildProcess | null = null;
  private pending: Map<string, {resolve, reject}> = new Map();

  async start(): Promise<void> {
    // 启动 C# 进程，监听 stdout
    this.process = spawn('dotnet', ['path/to/DocxConverter.dll']);
    this.process.stdout.on('data', this.handleResponse);
  }

  async convert(filePath: string): Promise<ConvertResult> {
    const id = uuid();
    const request = JSON.stringify({id, method: 'convert', params: {filePath}});
    this.process.stdin.write(request + '\n');
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
    });
  }

  async stop(): Promise<void> {
    // 发送退出指令，等待进程结束
  }
}
```

### plugin.ts - 插件接口

```typescript
class DocxPlugin implements DocumentPlugin {
  name = 'docx';
  supportedExtensions = ['doc', 'docx'];
  private service = new DocxService();

  async init() { await this.service.start(); }
  async dispose() { await this.service.stop(); }

  async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
    const result = await this.service.convert(filePath);
    return {
      markdown: result.markdown,
      mapping: result.mappings.map(m => ({
        markdownRange: {startLine: m.startLine, endLine: m.endLine},
        originalLocator: m.locator
      }))
    };
  }

  parseLocator(locator: string): LocatorInfo {
    // heading:2:项目背景
    const headingMatch = locator.match(/^heading:(\d+):(.+)$/);
    if (headingMatch) {
      const level = parseInt(headingMatch[1]);
      const title = headingMatch[2];
      return {
        displayText: `${'#'.repeat(level)} ${title}`,
        jumpInfo: { type: 'heading', level, title }
      };
    }

    // para:5
    const paraMatch = locator.match(/^para:(\d+)$/);
    if (paraMatch) {
      return {
        displayText: `第 ${parseInt(paraMatch[1]) + 1} 段`,
        jumpInfo: { type: 'paragraph', index: parseInt(paraMatch[1]) }
      };
    }

    // table:0
    const tableMatch = locator.match(/^table:(\d+)$/);
    if (tableMatch) {
      return {
        displayText: `表格 ${parseInt(tableMatch[1]) + 1}`,
        jumpInfo: { type: 'table', index: parseInt(tableMatch[1]) }
      };
    }

    return { displayText: locator };
  }
}
```

## 工作流程

```
1. 插件 init() 时启动 C# 进程
2. C# 进程进入 stdin 监听循环
3. 每次 toMarkdown() 调用通过 stdio 发送请求
4. C# 处理并通过 stdout 返回 JSON 结果
5. 插件 dispose() 时终止进程
```

## 下一步

1. 创建插件目录结构
2. 实现 C# DocxConverter 程序
3. 实现 TypeScript 插件层
4. 编写测试用例
5. 集成到 Agent FS 主项目

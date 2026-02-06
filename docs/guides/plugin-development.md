# 插件开发指南

> 适用于 Agent FS 当前实现（Storage Optimization 版本）

## 1. 目标与范围

插件负责把各类文档转换为统一的 Markdown 结构，并输出可定位信息，供 Indexer 构建：

- 向量索引（LanceDB）
- 倒排索引（SQLite）
- 原文归档（AFD）

本指南面向以下插件：

- `plugin-markdown`
- `plugin-pdf`
- `plugin-docx`
- `plugin-excel`
- 自定义格式插件（例如 `plugin-txt`）

---

## 2. 插件接口契约

以 `@agent-fs/core` 中定义为准。

## 2.1 `DocumentPlugin`

```ts
interface DocumentPlugin {
  name: string;
  supportedExtensions: string[]; // 不含点，如 ['md', 'txt']
  toMarkdown(filePath: string): Promise<DocumentConversionResult>;
  parseLocator?(locator: string): LocatorInfo;
  init?(): Promise<void>;
  dispose?(): Promise<void>;
}
```

## 2.2 `DocumentConversionResult`

```ts
interface DocumentConversionResult {
  markdown: string;
  mapping: PositionMapping[];
  searchableText?: SearchableEntry[];
}
```

## 2.3 `PositionMapping`

```ts
interface PositionMapping {
  markdownRange: {
    startLine: number; // 1-based
    endLine: number;   // 1-based
  };
  originalLocator: string;
}
```

## 2.4 `SearchableEntry`（可选但推荐）

```ts
interface SearchableEntry {
  text: string;
  markdownLine: number; // 1-based
  locator: string;
}
```

---

## 3. 何时需要 `searchableText`

## 3.1 可以不提供的场景

对纯文本类文档（Markdown / TXT），`chunk.content` 通常足够做倒排召回，此时可不提供 `searchableText`。

## 3.2 推荐提供的场景

对结构化文档（Excel、复杂表格、表单）建议提供 `searchableText`，便于：

- 精准控制可搜索文本粒度
- 保留更稳定的定位符（如 `sheet:销售/range:A1:D20`）
- 减少 Markdown 表格噪声对关键词检索的干扰

## 3.3 Indexer 使用规则

- 若 `searchableText` 有效，倒排索引优先使用它
- 否则回退到 `chunk.content`

---

## 4. 创建插件的标准步骤

## 4.1 包结构建议

```
packages/plugins/plugin-xxx/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── plugin.ts
    └── plugin.test.ts
```

## 4.2 实现 `toMarkdown`

核心要求：

1. 输出完整 `markdown`
2. 输出 `mapping`（覆盖所有可定位正文区域）
3. 结构化文档尽量输出 `searchableText`

## 4.3 实现 `parseLocator`（推荐）

`parseLocator` 负责把机器定位符转为可读文案，便于 UI 与 MCP 返回展示。

---

## 5. 最小可用示例（TXT）

```ts
import { readFileSync } from 'node:fs';
import type {
  DocumentPlugin,
  DocumentConversionResult,
  LocatorInfo,
  PositionMapping,
} from '@agent-fs/core';

export class TxtPlugin implements DocumentPlugin {
  readonly name = 'txt';
  readonly supportedExtensions = ['txt'];

  async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
    const markdown = readFileSync(filePath, 'utf-8');
    const lines = markdown.split('\n');

    const mapping: PositionMapping[] = [];
    let segmentStart = 1;

    for (let i = 1; i <= lines.length; i += 1) {
      const current = lines[i - 1]?.trim() ?? '';
      const ended = i === lines.length || current.length === 0;
      if (!ended) continue;

      const endLine = current.length === 0 ? i - 1 : i;
      if (endLine >= segmentStart) {
        mapping.push({
          markdownRange: { startLine: segmentStart, endLine },
          originalLocator: `line:${segmentStart}-${endLine}`,
        });
      }
      segmentStart = i + 1;
    }

    return { markdown, mapping };
  }

  parseLocator(locator: string): LocatorInfo {
    const match = /^line:(\d+)-(\d+)$/u.exec(locator);
    if (!match) return { displayText: locator };
    const [, start, end] = match;
    return {
      displayText: `第 ${start}-${end} 行`,
      jumpInfo: { line: Number(start) },
    };
  }
}
```

---

## 6. 结构化文档示例（Excel 风格）

下面示例演示“区域级 mapping + entry 级 searchableText”的组合：

```ts
import type {
  DocumentConversionResult,
  DocumentPlugin,
  PositionMapping,
  SearchableEntry,
} from '@agent-fs/core';

interface Region {
  range: string;
  markdown: string;
  searchableEntries?: Array<{ text: string; locator: string }>;
}

export class DemoExcelPlugin implements DocumentPlugin {
  readonly name = 'demo-excel';
  readonly supportedExtensions = ['xlsx'];

  async toMarkdown(filePath: string): Promise<DocumentConversionResult> {
    const regions: Region[] = await this.loadRegions(filePath);

    let markdown = '';
    let currentLine = 1;
    const mapping: PositionMapping[] = [];
    const searchableText: SearchableEntry[] = [];

    for (const region of regions) {
      markdown += `### 区域 ${region.range}\n`;
      currentLine += 1;

      const regionStartLine = currentLine;
      markdown += `${region.markdown}\n\n`;
      const regionLines = region.markdown.split('\n').length;

      mapping.push({
        markdownRange: {
          startLine: regionStartLine,
          endLine: regionStartLine + regionLines - 1,
        },
        originalLocator: `sheet:默认/range:${region.range}`,
      });

      for (const entry of region.searchableEntries ?? []) {
        searchableText.push({
          text: this.normalize(entry.text),
          markdownLine: regionStartLine,
          locator: entry.locator,
        });
      }

      currentLine += regionLines + 1;
    }

    return { markdown, mapping, searchableText };
  }

  private async loadRegions(_filePath: string): Promise<Region[]> {
    return [];
  }

  private normalize(text: string): string {
    return text.replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim();
  }
}
```

---

## 7. Locator 设计建议

Locator 的质量直接影响 `get_chunk` 与结果可读性。

推荐规则：

- **稳定性**：同一内容重复索引时，locator 尽量保持稳定
- **可解释性**：优先使用语义化格式（如 `page:3`、`sheet:销售/range:A1:D20`）
- **可解析性**：确保 `parseLocator` 可以稳定解析

推荐格式示例：

- Markdown/TXT：`line:12-20`
- PDF：`page:5`
- DOCX：`heading:第三章/para:7`
- Excel：`sheet:库存/range:B2:F12`

---

## 8. 与索引器协作细节

`IndexPipeline` 对插件输出的使用方式：

1. `markdown` → `MarkdownChunker` 切分 chunk
2. `mapping` → 参与定位信息回填，并落入 AFD 的 `metadata.json`
3. `searchableText` → 构建倒排索引（优先级高于 chunk 文本）

注意事项：

- `markdownLine` 必须为 1-based
- `markdownLine` 必须能落到真实 chunk 行范围内，否则该 entry 会被忽略
- `searchableText` 内容建议先做去噪与空白归一

---

## 9. 测试要求

每个插件至少包含以下单测：

- `toMarkdown()` 成功路径
- `mapping` 行号范围正确
- `parseLocator()` 解析正确（若实现）
- 结构化插件：`searchableText` 输出与 locator 对齐

建议补充：

- 非法输入 / 空文档 / 超大文档
- 外部进程插件的超时与崩溃恢复

最小测试示例：

```ts
import { describe, expect, it } from 'vitest';
import { TxtPlugin } from './plugin';

describe('TxtPlugin', () => {
  it('返回 markdown 与 mapping', async () => {
    const plugin = new TxtPlugin();
    const result = await plugin.toMarkdown('/tmp/a.txt');
    expect(result.markdown.length).toBeGreaterThan(0);
    expect(result.mapping.length).toBeGreaterThan(0);
  });
});
```

---

## 10. 调试清单

出现“检索不到内容”时，优先检查：

1. `supportedExtensions` 是否匹配真实后缀
2. `mapping` 行号是否越界或错位
3. `searchableText.markdownLine` 是否落在 chunk 行范围
4. locator 是否可被 `parseLocator` 识别
5. 插件是否在 `PluginManager` 中完成注册与初始化

---

## 11. 最佳实践

- 输出结构化、可读的 Markdown（标题层级、表格结构尽量保留）
- 对可搜索文本做标准化（去噪、合并空白、去除无意义符号）
- 避免把二进制或超长冗余文本直接塞入 `searchableText`
- 保证 `toMarkdown` 幂等（同输入、同输出）

---

## 12. 发布前检查

- [ ] 插件单测通过
- [ ] 能被 `PluginManager` 发现并注册
- [ ] 端到端索引后可被 `search` 召回
- [ ] `get_chunk` 返回内容与定位正确
- [ ] 文档（本指南或插件 README）已同步更新

---

*文档版本：2.0*  
*更新日期：2026-02-06*

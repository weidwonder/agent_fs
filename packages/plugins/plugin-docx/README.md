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

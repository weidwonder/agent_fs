# Phase 03: DOCX TS 插件 parseLocator 升级

## Context Links

- Brainstorm: [`./reports/brainstorm-260409-1444-page-number-marking-pdf-docx.md`](./reports/brainstorm-260409-1444-page-number-marking-pdf-docx.md)
- 主计划: [`plan.md`](./plan.md)
- 相关代码:
  - `packages/plugins/plugin-docx/src/plugin.ts`
  - `packages/plugins/plugin-docx/src/plugin.test.ts`
- 上游依赖: Phase 2（.NET 侧输出的新 locator 格式）
- 下游依赖: Phase 4（搜索回显）

## Overview

- **Date:** 2026-04-09
- **Description:** 升级 plugin-docx TS 侧 `parseLocator`，识别 `page:N/<tail>` 前缀：剥离后递归解析尾部，保持对旧 `heading:/para:/table:` 格式的完全向后兼容
- **Priority:** P2
- **Implementation Status:** pending
- **Review Status:** pending
- **Effort:** 0.5h

## Key Insights

- 现有 `parseLocator` 使用纯正则分派三种格式：`^heading:(\d+):(.+)$` / `^para:(\d+)$` / `^table:(\d+)$`
- 新格式 `page:N/<tail>` 只需在函数入口先匹配前缀正则 `^page:(\d+)\/(.+)$`，命中则抽出页码 + 剥离后递归调用自身解析尾部，并把 page 合并到结果对象
- **向后兼容：** 不命中前缀则走原分派逻辑，老 locator 零改动工作
- 返回值结构需决定：在现有 locator 对象上加 `page?: number` 字段（最小侵入），不改已有字段语义

## Requirements

**功能：**
- `parseLocator("page:3/para:12")` → `{ kind: "para", index: 12, page: 3 }`
- `parseLocator("page:3/heading:2:第二章 引言")` → `{ kind: "heading", level: 2, title: "第二章 引言", page: 3 }`
- `parseLocator("page:3/table:1")` → `{ kind: "table", index: 1, page: 3 }`
- `parseLocator("para:12")` → `{ kind: "para", index: 12 }`（`page` 字段 undefined）
- `parseLocator("heading:2:标题")` → `{ kind: "heading", level: 2, title: "标题" }`
- 非法输入返回 null 或抛错（与现行为保持一致）

**非功能：**
- 单元测试覆盖新格式 3 种 + 旧格式 3 种 + 非法格式 1 种 = 7 个用例
- 不改动 `LocatorParseResult` 或等价类型的字段语义

## Architecture

**改动点：** 仅 `parseLocator` 一个函数，加一段前缀剥离逻辑。

**伪代码：**

```typescript
const PAGE_PREFIX_RE = /^page:(\d+)\/(.+)$/;

function parseLocator(locator: string): LocatorParseResult | null {
  const pageMatch = locator.match(PAGE_PREFIX_RE);
  if (pageMatch) {
    const page = parseInt(pageMatch[1], 10);
    const tail = pageMatch[2];
    const inner = parseLocator(tail); // 递归
    if (!inner) return null;
    return { ...inner, page };
  }
  // 原有分派逻辑保持不变
  if (/^heading:/.test(locator)) { ... }
  if (/^para:/.test(locator))    { ... }
  if (/^table:/.test(locator))   { ... }
  return null;
}
```

**类型扩展：**

```typescript
interface LocatorParseResultBase {
  page?: number;  // 新增
}
interface HeadingLocator extends LocatorParseResultBase { kind: "heading"; level: number; title: string; }
interface ParaLocator    extends LocatorParseResultBase { kind: "para"; index: number; }
interface TableLocator   extends LocatorParseResultBase { kind: "table"; index: number; }
type LocatorParseResult = HeadingLocator | ParaLocator | TableLocator;
```

## Related Code Files

**修改：**
- `packages/plugins/plugin-docx/src/plugin.ts` — `parseLocator` 函数 + 类型定义
- `packages/plugins/plugin-docx/src/plugin.test.ts` — 新增 7 个用例

**创建：** 无

**删除：** 无

## Implementation Steps

1. 在 `plugin.ts` 中定位 `parseLocator` 函数与对应返回类型
2. 在共同基类（或各具体类型）加 `page?: number`
3. 在 `parseLocator` 入口添加 `PAGE_PREFIX_RE` 匹配 + 递归解析逻辑
4. 新增单元测试用例（plugin.test.ts）：
   - 3 个新格式正例
   - 3 个旧格式回归
   - 1 个非法格式（如 `page:abc/para:12` 应返回 null 或抛错）
5. 运行 `pnpm --filter @agent-fs/plugin-docx test`
6. 运行 `pnpm --filter @agent-fs/plugin-docx build` 确认 TS 编译通过

## Todo list

- [ ] 扩展 `LocatorParseResult` 类型加 `page?: number`
- [ ] `parseLocator` 入口增加前缀剥离 + 递归
- [ ] 新增 7 个单测用例
- [ ] `pnpm --filter @agent-fs/plugin-docx test` 通过
- [ ] `pnpm --filter @agent-fs/plugin-docx build` 通过

## Success Criteria

- 7 个测试全绿
- 旧格式 locator 解析结果与本次改动前完全一致（回归无退化）
- 类型层面 `page` 字段对已有调用方透明（optional，不强制消费）

## Risk Assessment

| 风险 | 缓解 |
|---|---|
| 递归解析造成栈溢出（理论上） | 前缀只剥一次，内部不会再有 `page:` 嵌套，实际不会递归超过 1 层 |
| 类型改动破坏现有 import | `page?: number` 为可选字段，TS 结构类型兼容 |
| 正则对 heading title 中含 `/` 的情况误切 | 前缀正则用非贪婪或严格 `^page:\d+\/` 锚定，尾部作为一整串交给原 dispatcher 解析 |
| 测试中样本 heading title 含 `/` | 补一个用例 `page:3/heading:2:1/2 进度` 断言 title 完整保留 |

## Security Considerations

N/A — 纯字符串解析。

## Next Steps

- Phase 4：mcp-server 的 locator-display 会消费 `page` 字段生成回显字符串
- Phase 6：端到端验收时 search → 回显链路会联动验证

# Phase 06: 端到端验证与回归

## Context Links

- Brainstorm: [`./reports/brainstorm-260409-1444-page-number-marking-pdf-docx.md`](./reports/brainstorm-260409-1444-page-number-marking-pdf-docx.md)
- 主计划: [`plan.md`](./plan.md)
- 上游依赖: Phase 1, 2, 3, 4（Phase 5 可选）
- 下游依赖: 无（终验 phase）

## Overview

- **Date:** 2026-04-09
- **Description:** 准备真实样本，跑完整 indexer → search → MCP 回显链路，验证 PDF/DOCX 页码标记落地效果，同时回归 Excel / markdown 纯文本 / 已有 chunker 的零退化
- **Priority:** P2
- **Implementation Status:** pending
- **Review Status:** pending
- **Effort:** 1h

## Key Insights

- 手测 + 自动回归并行：单测覆盖算法正确性，手测覆盖真实文件边缘情况
- 样本库分四类：
  1. Word 保存的多页 docx（有 `LastRenderedPageBreak`）
  2. python-docx 生成的 docx（无页码，验证降级路径）
  3. 多页 PDF（任意来源均可）
  4. 现有 Excel / markdown 样本（回归）
- 验收要点：搜索结果的 `displayLocator` 字符串 + chunk content 不含页注释两者同时成立

## Requirements

**功能验收：**
- 对每类样本发起 search 查询，返回结果结构符合预期
- chunk content 无 `<!-- page: N -->` 泄漏
- displayLocator 字段符合各扩展名的规范
- Electron 前端（若有 markdown 预览组件）不把页注释渲染为可见内容

**回归验收：**
- `pnpm -r test` 全绿
- `pnpm -r build` 无错
- Docker 镜像 build 成功（dotnet 子模块）
- 现有 plan 目录内的 chunker 测试 0 退化

## Architecture

```
验收分两层：

Layer 1: 自动化
  pnpm -r test              # 全仓测试
  pnpm -r build             # 全仓构建
  docker build ...          # 镜像构建（可选）

Layer 2: 手动 E2E
  1. 准备 4 类样本到 tmp/samples/
  2. 启动 Electron 或直接 indexer CLI 索引样本目录
  3. 通过 MCP client（或直接调 search tool）发起查询
  4. 逐项对照预期
```

## Related Code Files

**修改：** 无

**创建：**
- `plans/260409-1444-page-number-marking-pdf-docx/validation-samples.md` — 记录样本来源、预期输出、实际结果表格

**删除：** 无

## Implementation Steps

1. **样本准备**（0.2h）
   - 用 Word 新建一份 ≥5 页 docx，含标题 / 段落 / 表格，保存到 `tmp/samples/word-5pages.docx`
   - 用 python-docx 脚本生成一份 3 页 docx，保存到 `tmp/samples/python-3pages.docx`
   - 准备一份多页 PDF（技术文档或论文），`tmp/samples/multipage.pdf`
   - 复用已有 Excel / md 样本

2. **自动化回归**（0.2h）
   ```bash
   pnpm -r test
   pnpm -r build
   pnpm --filter @agent-fs/core test   # chunker 回归
   ```
   全部通过才继续下一步

3. **手动 E2E — PDF 路径**（0.15h）
   - 用 indexer CLI 索引 `tmp/samples/multipage.pdf`
   - 查询一个正文词
   - 预期：返回 hit 的 `displayLocator` 形如 `第 N 页`，content 不含 HTML 注释
   - 抽查 md 产物文件确认每页首有 `<!-- page: N -->`

4. **手动 E2E — DOCX 有页码路径**（0.15h）
   - 索引 `word-5pages.docx`
   - 查询一个段落中的词
   - 预期：`displayLocator` 形如 `第 N 页 · 第 M 段` 或 `第 N 页 · 标题 "..."`
   - 抽查 md 产物每页首有 `<!-- page: N -->`
   - 肉眼对比 Word 中显示的页码是否匹配

5. **手动 E2E — DOCX 降级路径**（0.1h）
   - 索引 `python-3pages.docx`
   - 查询一个段落词
   - 预期：`displayLocator` 为 `第 M 段`（无页前缀），md 产物无页注释
   - 确认转换流程不抛错

6. **Excel / md 回归**（0.1h）
   - 重跑 Excel 样本 search，displayLocator 仍为 `工作表 N / A1:B3`
   - 重跑 md 样本，无任何页相关字段泄漏

7. **Electron 前端检查**（0.1h，可选）
   - 启动 Electron app，打开搜索界面
   - 点击一条 PDF hit，确认页码回显正确显示、跳页按钮可点
   - 若有 md 预览，核对注释未被渲染为可见文本

8. **填写 `validation-samples.md`** 记录每项预期/实际/状态

## Todo list

- [ ] 准备 4 类样本文件到 `tmp/samples/`
- [ ] `pnpm -r test` 通过
- [ ] `pnpm -r build` 通过
- [ ] PDF E2E 验收通过
- [ ] DOCX 有页码 E2E 验收通过
- [ ] DOCX 降级 E2E 验收通过
- [ ] Excel 回归通过
- [ ] md 纯文本回归通过
- [ ] Electron 前端抽查（若适用）
- [ ] 填写 `validation-samples.md`
- [ ] 主 `plan.md` phase 状态全部标记为 completed

## Success Criteria

- Layer 1 全自动测试 100% 通过
- Layer 2 手动验收 8 个项目全通过
- 主计划的 brainstorm 成功指标表（第 6 节）逐条达成：
  - PDF md 正文每页有 `<!-- page: N -->`
  - DOCX 正文页码与 Word 显示一致
  - DOCX 无 break 时不抛错
  - 搜索结果回显含"第 N 页"
  - 现有 chunker 测试零退化
  - chunk 内容剥离注释
  - Excel 回显路径不受影响

## Risk Assessment

| 风险 | 缓解 |
|---|---|
| 样本选择偏颇导致漏测边缘情况 | 至少覆盖 Word 保存 / 第三方生成 / 超长文档 / 含表格 四种 |
| Electron 前端未同步适配回显字段 | 本计划范围不含前端改动；若前端无接入，记录为 follow-up |
| Docker 构建耗时阻塞验收 | 放最后跑，Phase 1–4 单元测试已给足信心 |
| 手测不可重复、回归难 | 把样本与预期写入 `validation-samples.md`，下次回归可复用 |

## Security Considerations

N/A — 仅本地样本文件，不涉及外部网络或用户数据。

## Next Steps

- 本 phase 通过后关闭整个计划
- Phase 5 若后续解锁，按相同 E2E 流程做增量验收
- 若前端未同步适配回显字段，开 follow-up 任务到 electron-app package

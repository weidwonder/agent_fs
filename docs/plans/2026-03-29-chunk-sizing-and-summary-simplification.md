# Chunk 大小与 Summary 简化 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将默认 chunk 大小调整为 `400-800`，彻底移除 chunk summary 链路，并把文档 summary 改为直接基于 markdown 生成。

**Architecture:** 保留现有 MarkdownChunker 的主切分算法，只修改阈值。索引、回填、向量存储、搜索与 UI 同步收敛到“chunk 只负责内容检索，summary 只保留文档级与目录级”这一模型。旧索引不做兼容迁移，变更后通过重新索引生效。

**Tech Stack:** TypeScript, Node.js, zod, LanceDB, Electron, Vitest, unified/remark

---

### Task 1: 调整默认 chunk 配置并清理共享类型

**Files:**
- Modify: `packages/core/src/config/schema.ts`
- Modify: `packages/core/src/config/schema.test.ts`
- Modify: `packages/core/src/types/config.ts`
- Modify: `packages/core/src/types/storage.ts`
- Modify: `packages/core/src/types/config.test.ts`

**Step 1: 写失败测试**

```typescript
it('应使用新的 chunk 默认值', () => {
  const parsed = configSchema.parse(baseConfig);
  expect(parsed.indexing.chunk_size.min_tokens).toBe(400);
  expect(parsed.indexing.chunk_size.max_tokens).toBe(800);
});
```

**Step 2: 运行测试，确认失败**

Run: `pnpm vitest run packages/core/src/config/schema.test.ts packages/core/src/types/config.test.ts`
Expected: FAIL，默认值仍然是 `600/1200`，共享类型仍包含 `summary_vector/hybrid_vector`

**Step 3: 写最小实现**

在 `packages/core/src/config/schema.ts` 中修改：

```typescript
chunk_size: z.object({
  min_tokens: z.number().int().positive().default(400),
  max_tokens: z.number().int().positive().default(800),
}),
```

在 `packages/core/src/types/storage.ts` 中将 `VectorDocument` 收敛为：

```typescript
export interface VectorDocument {
  chunk_id: string;
  file_id: string;
  dir_id: string;
  rel_path: string;
  file_path: string;
  chunk_line_start: number;
  chunk_line_end: number;
  content_vector: number[];
  locator: string;
  indexed_at: string;
  deleted_at: string;
}
```

**Step 4: 运行测试，确认通过**

Run: `pnpm vitest run packages/core/src/config/schema.test.ts packages/core/src/types/config.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add packages/core/src/config/schema.ts packages/core/src/config/schema.test.ts packages/core/src/types/config.ts packages/core/src/types/storage.ts packages/core/src/types/config.test.ts
git commit -m "refactor(core): shrink chunk defaults and vector types"
```

---

### Task 2: 重写 SummaryService，只保留文档级与目录级摘要

**Files:**
- Modify: `packages/llm/src/summary/service.ts`
- Modify: `packages/llm/src/summary/prompts.ts`
- Modify: `packages/llm/src/summary/service.test.ts`
- Delete: `packages/llm/src/summary/batch-utils.ts`
- Delete: `packages/llm/src/summary/batch-utils.test.ts`

**Step 1: 写失败测试**

```typescript
it('应直接基于 markdown 生成文档摘要', async () => {
  const result = await service.generateDocumentSummary('demo.md', '# 标题\n\n正文');
  expect(result.summary).toBe('文档摘要');
});

it('markdown 超过 10k token 时应回退到前 1000 token 加全部标题', async () => {
  await service.generateDocumentSummary('demo.md', longMarkdown);
  expect(fetchMock).toHaveBeenCalled();
  expect(lastPrompt).toContain('文档开头正文');
  expect(lastPrompt).toContain('文档章节结构');
});
```

**Step 2: 运行测试，确认失败**

Run: `pnpm vitest run packages/llm/src/summary/service.test.ts`
Expected: FAIL，当前 `generateDocumentSummary` 仍要求 `chunk summaries`

**Step 3: 写最小实现**

在 `packages/llm/src/summary/prompts.ts` 中把文档摘要提示词改为接受完整 markdown：

```typescript
export const DOCUMENT_SUMMARY_PROMPT = `请为以下文档生成一个综合摘要（100-200字）：

文档名称：{filename}

文档内容：
{document_content}

文档摘要：`;
```

在 `packages/llm/src/summary/service.ts` 中：

```typescript
async generateDocumentSummary(filename: string, markdown: string, options: SummaryOptions = {}) {
  const promptInput = this.buildDocumentSummaryInput(markdown);
  const prompt = DOCUMENT_SUMMARY_PROMPT
    .replace('{filename}', filename)
    .replace('{document_content}', promptInput);
  const summary = await this.callLLM(this.buildMessages(prompt), options);
  return { summary, fromCache: false, fallback: false };
}
```

并新增 `buildDocumentSummaryInput()`：

- `countTokens(markdown) <= 10000` 时直接返回全文
- 超过 `10000` 时返回“前 `1000 token` 正文 + 全部标题”

**Step 4: 运行测试，确认通过**

Run: `pnpm vitest run packages/llm/src/summary/service.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add packages/llm/src/summary/service.ts packages/llm/src/summary/prompts.ts packages/llm/src/summary/service.test.ts
git rm packages/llm/src/summary/batch-utils.ts packages/llm/src/summary/batch-utils.test.ts
git commit -m "refactor(llm): remove chunk summary generation"
```

---

### Task 3: 简化索引流水线与 AFD 摘要结构

**Files:**
- Modify: `packages/indexer/src/pipeline.ts`
- Modify: `packages/indexer/src/pipeline.test.ts`
- Modify: `packages/indexer/src/pipeline.integration.test.ts`

**Step 1: 写失败测试**

```typescript
expect(summaryService.generateChunkSummariesBatch).not.toHaveBeenCalled();
expect(summaryService.generateDocumentSummary).toHaveBeenCalledWith(
  'docs/a.md',
  expect.stringContaining('# 标题'),
  expect.any(Object),
);

const summaries = JSON.parse(afdPayload['summaries.json']);
expect(summaries).toEqual({ documentSummary: '文档摘要' });
expect(vectorDocs[0]).not.toHaveProperty('summary_vector');
expect(vectorDocs[0]).not.toHaveProperty('hybrid_vector');
```

**Step 2: 运行测试，确认失败**

Run: `pnpm vitest run packages/indexer/src/pipeline.test.ts packages/indexer/src/pipeline.integration.test.ts`
Expected: FAIL，当前流水线仍生成 chunk summaries 并写入 `summary_vector/hybrid_vector`

**Step 3: 写最小实现**

在 `packages/indexer/src/pipeline.ts` 中：

- 删除 `generateChunkSummariesBatch()` 调用
- 文档摘要改为：

```typescript
const docSummaryResult = await summaryService.generateDocumentSummary(
  relativeFilePath,
  conversionResult.markdown,
  {
    maxRetries: summaryOptions.maxRetries,
    timeoutMs: summaryOptions.timeoutMs,
  }
);
```

- 向量写入只保留：

```typescript
docs.push({
  chunk_id: chunkIds[i],
  file_id: fileId,
  dir_id: dirId,
  rel_path: relativeFilePath,
  file_path: filePath,
  chunk_line_start: chunk.lineStart,
  chunk_line_end: chunk.lineEnd,
  content_vector: contentEmbed,
  locator: chunk.locator,
  indexed_at: now,
  deleted_at: '',
});
```

- `summaries.json` 改为：

```typescript
{
  documentSummary,
}
```

**Step 4: 运行测试，确认通过**

Run: `pnpm vitest run packages/indexer/src/pipeline.test.ts packages/indexer/src/pipeline.integration.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add packages/indexer/src/pipeline.ts packages/indexer/src/pipeline.test.ts packages/indexer/src/pipeline.integration.test.ts
git commit -m "refactor(indexer): remove chunk summaries from pipeline"
```

---

### Task 4: 简化向量存储与搜索融合逻辑

**Files:**
- Modify: `packages/search/src/vector-store/store.ts`
- Modify: `packages/search/src/vector-store/store.test.ts`
- Modify: `packages/search/src/fusion/search-fusion.ts`
- Modify: `packages/search/src/fusion/search-fusion.test.ts`
- Modify: `packages/mcp-server/src/tools/search.ts`
- Modify: `packages/mcp-server/src/tools/search.test.ts`

**Step 1: 写失败测试**

```typescript
it('应只创建 content_vector schema', async () => {
  const results = await store.searchByContent([1, 0, 0], { topK: 1 });
  expect(results[0].document).not.toHaveProperty('summary_vector');
});

it('搜索融合应只查询 content_vector 和 bm25', async () => {
  await fusion.search({ query: '制度', scope: ['/tmp/demo'] });
  expect(vectorStore.searchByContent).toHaveBeenCalledTimes(1);
  expect(vectorStore.searchBySummary).not.toHaveBeenCalled();
});
```

**Step 2: 运行测试，确认失败**

Run: `pnpm vitest run packages/search/src/vector-store/store.test.ts packages/search/src/fusion/search-fusion.test.ts packages/mcp-server/src/tools/search.test.ts`
Expected: FAIL，当前 schema 和搜索仍依赖 `summary_vector/hybrid_vector`

**Step 3: 写最小实现**

在 `packages/search/src/vector-store/store.ts` 中删除：

- `summary_vector`
- `hybrid_vector`
- `searchBySummary()`
- `searchByHybrid()`
- `updateChunkVectors()`
- `withHybridVector()` 及相关辅助逻辑

并将 schema 收敛到：

```typescript
const REQUIRED_SCHEMA_FIELDS = new Set([
  'chunk_id',
  'file_id',
  'dir_id',
  'rel_path',
  'file_path',
  'chunk_line_start',
  'chunk_line_end',
  'content_vector',
  'locator',
  'indexed_at',
  'deleted_at',
]);
```

在 `packages/search/src/fusion/search-fusion.ts` 中移除 `useSummaryVector` 分支，只保留 `content_vector + bm25`。

在 `packages/mcp-server/src/tools/search.ts` 中删除对 `hybrid_vector` 的引用，并将结果中的摘要来源改为文件级摘要或空字符串。

**Step 4: 运行测试，确认通过**

Run: `pnpm vitest run packages/search/src/vector-store/store.test.ts packages/search/src/fusion/search-fusion.test.ts packages/mcp-server/src/tools/search.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add packages/search/src/vector-store/store.ts packages/search/src/vector-store/store.test.ts packages/search/src/fusion/search-fusion.ts packages/search/src/fusion/search-fusion.test.ts packages/mcp-server/src/tools/search.ts packages/mcp-server/src/tools/search.test.ts
git commit -m "refactor(search): use content vectors only"
```

---

### Task 5: 简化 Summary Backfill、概况统计与 Electron 展示

**Files:**
- Modify: `packages/indexer/src/indexer.ts`
- Modify: `packages/electron-app/src/main/index.ts`
- Modify: `packages/electron-app/src/renderer/types/electron.d.ts`
- Modify: `packages/electron-app/src/renderer/components/ProjectOverviewDialog.tsx`
- Modify: `packages/electron-app/src/renderer/components/project-overview-dialog.test.ts`

**Step 1: 写失败测试**

```typescript
expect(result.chunkUpdated).toBe(false);
expect(result.generatedChunkCount).toBe(0);
expect(result.documentSummaryUpdated).toBe(true);

expect(overview.summaryCoverage).toEqual({
  document: expect.any(Object),
  directory: expect.any(Object),
});
```

**Step 2: 运行测试，确认失败**

Run: `pnpm vitest run packages/indexer/src/indexer.test.ts packages/electron-app/src/renderer/components/project-overview-dialog.test.ts`
Expected: FAIL，当前 backfill 仍会补 chunk summary，UI 仍展示 chunk 覆盖率

**Step 3: 写最小实现**

在 `packages/indexer/src/indexer.ts` 中：

- 删除 `generateChunkSummariesBatch()` 与摘要向量回写逻辑
- `backfillFileSummary()` 只读取 `content.md`
- 若 `file.summary` 为空，则直接基于 markdown 生成文档摘要
- `summaries.json` 仅写 `{ documentSummary }`

在 `packages/electron-app/src/main/index.ts` 中移除 chunk summary coverage 统计。

在 `packages/electron-app/src/renderer/components/ProjectOverviewDialog.tsx` 中移除：

- `chunkGenerated`
- `overview.summaryCoverage.chunk`
- 补全 Summary 时的 chunk 覆盖增量展示

**Step 4: 运行测试，确认通过**

Run: `pnpm vitest run packages/indexer/src/indexer.test.ts packages/electron-app/src/renderer/components/project-overview-dialog.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add packages/indexer/src/indexer.ts packages/electron-app/src/main/index.ts packages/electron-app/src/renderer/types/electron.d.ts packages/electron-app/src/renderer/components/ProjectOverviewDialog.tsx packages/electron-app/src/renderer/components/project-overview-dialog.test.ts
git commit -m "refactor(app): remove chunk summary backfill and coverage"
```

---

### Task 6: 调整 MCP 读取逻辑、同步文档并完成回归验证

**Files:**
- Modify: `packages/mcp-server/src/tools/get-chunk.ts`
- Modify: `packages/mcp-server/src/tools/get-chunk.test.ts`
- Modify: `docs/requirements.md`
- Modify: `docs/architecture.md`
- Modify: `docs/guides/plugin-development.md`

**Step 1: 写失败测试**

```typescript
expect(result.chunk.summary).toBe('');
expect(result.chunk.content).toContain('正文');
```

并检查文档文字是否反映：

- chunk 默认 `400-800`
- 不再生成 chunk summary
- 文档 summary 直接基于 markdown

**Step 2: 运行测试，确认失败**

Run: `pnpm vitest run packages/mcp-server/src/tools/get-chunk.test.ts`
Expected: FAIL，当前 `get_chunk` 仍尝试按 chunkId 从 `summaries.json` 读取摘要

**Step 3: 写最小实现**

在 `packages/mcp-server/src/tools/get-chunk.ts` 中，将 `summaries.json` 视为文档级摘要存储，不再按 `chunk_id` 查找摘要：

```typescript
let documentSummary = '';
try {
  const summaryBuffer = await storage.read(fileInfo.afdName, 'summaries.json');
  documentSummary = JSON.parse(summaryBuffer.toString('utf-8')).documentSummary ?? '';
} catch {
  documentSummary = '';
}
```

`ChunkInfo.summary` 若继续保留字段，则返回空字符串；不要伪造 chunk 摘要。

同步更新 `docs/requirements.md`、`docs/architecture.md`、`docs/guides/plugin-development.md` 中关于 chunk summary、hybrid vector、backfill 的描述。

**Step 4: 运行回归验证**

Run: `pnpm vitest run packages/mcp-server/src/tools/get-chunk.test.ts packages/indexer/src/pipeline.test.ts packages/indexer/src/pipeline.integration.test.ts packages/search/src/vector-store/store.test.ts packages/search/src/fusion/search-fusion.test.ts packages/llm/src/summary/service.test.ts packages/electron-app/src/renderer/components/project-overview-dialog.test.ts`
Expected: PASS

Run: `pnpm test`
Expected: PASS

**Step 5: 提交**

```bash
git add packages/mcp-server/src/tools/get-chunk.ts packages/mcp-server/src/tools/get-chunk.test.ts docs/requirements.md docs/architecture.md docs/guides/plugin-development.md
git commit -m "docs: sync chunk and summary simplification"
```


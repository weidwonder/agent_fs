# Summary Batch/Skip Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 增加 summary 的 batch/skip 模式，并按 token 预算批量生成摘要，默认 batch。

**Architecture:** 在配置层新增 summary.mode 与批量预算；SummaryService 增加批量生成与 JSON 容错；Indexer 根据模式分流并保持进度上报。失败时摘要直接置空。

**Tech Stack:** TypeScript, zod, existing tokenizer, OpenAI-compatible LLM

---

### Task 1: 配置类型与校验扩展

**Files:**
- Modify: `packages/core/src/types/config.ts`
- Modify: `packages/core/src/config/schema.ts`
- Test: `packages/core/src/config/schema.test.ts`

**Step 1: 写失败测试（schema 默认值与 mode 校验）**

```typescript
import { describe, expect, it } from 'vitest';
import { configSchema } from '../schema';

describe('summary config', () => {
  it('applies default summary mode and budget', () => {
    const parsed = configSchema.parse({});
    expect(parsed.summary?.mode).toBe('batch');
    expect(parsed.summary?.chunk_batch_token_budget).toBe(10000);
  });

  it('rejects invalid summary mode', () => {
    expect(() =>
      configSchema.parse({ summary: { mode: 'invalid' } })
    ).toThrow();
  });
});
```

**Step 2: 运行测试，确认失败**

Run: `pnpm -C packages/core test -- schema.test.ts`
Expected: FAIL（summary 字段/默认值不存在或校验未定义）

**Step 3: 写最小实现**

在 `packages/core/src/types/config.ts` 增加：

```typescript
export type SummaryMode = 'batch' | 'skip';

export interface SummaryConfig {
  mode?: SummaryMode;
  chunk_batch_token_budget?: number;
  timeout_ms?: number;
  max_retries?: number;
}
```

并在 `Config` 中补入 `summary?: SummaryConfig`。

在 `packages/core/src/config/schema.ts` 增加：

```typescript
const summarySchema = z
  .object({
    mode: z.enum(['batch', 'skip']).default('batch'),
    chunk_batch_token_budget: z.number().int().positive().default(10000),
    timeout_ms: z.number().int().positive().optional(),
    max_retries: z.number().int().min(0).max(2).optional(),
  })
  .optional();
```

并在主 schema 中挂入 `summary: summarySchema`。

**Step 4: 运行测试，确认通过**

Run: `pnpm -C packages/core test -- schema.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add packages/core/src/types/config.ts packages/core/src/config/schema.ts packages/core/src/config/schema.test.ts
git commit -m "feat(core): add summary mode and batch budget config"
```

---

### Task 2: 批量分组与 JSON 容错测试

**Files:**
- Create: `packages/llm/src/summary/batch-utils.ts`
- Test: `packages/llm/src/summary/batch-utils.test.ts`

**Step 1: 写失败测试（首次超预算切批 + 单条超预算）**

```typescript
import { describe, expect, it } from 'vitest';
import { groupByTokenBudget } from './batch-utils';

describe('groupByTokenBudget', () => {
  it('splits when next item would exceed budget', () => {
    const items = [
      { id: 'a', tokens: 4 },
      { id: 'b', tokens: 4 },
      { id: 'c', tokens: 4 },
    ];

    const batches = groupByTokenBudget(items, 8);
    expect(batches.map((b) => b.map((i) => i.id))).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
  });

  it('keeps oversized item as a single batch', () => {
    const items = [
      { id: 'a', tokens: 12 },
      { id: 'b', tokens: 3 },
    ];
    const batches = groupByTokenBudget(items, 10);
    expect(batches.map((b) => b.map((i) => i.id))).toEqual([
      ['a'],
      ['b'],
    ]);
  });
});
```

**Step 2: 运行测试，确认失败**

Run: `pnpm -C packages/llm test -- batch-utils.test.ts`
Expected: FAIL（函数不存在）

**Step 3: 写最小实现**

`packages/llm/src/summary/batch-utils.ts`：

```typescript
export interface TokenItem<T> {
  id: string;
  tokens: number;
  payload: T;
}

export function groupByTokenBudget<T>(items: TokenItem<T>[], budget: number): TokenItem<T>[][] {
  const batches: TokenItem<T>[][] = [];
  let current: TokenItem<T>[] = [];
  let total = 0;

  for (const item of items) {
    if (item.tokens > budget) {
      if (current.length > 0) {
        batches.push(current);
        current = [];
        total = 0;
      }
      batches.push([item]);
      continue;
    }

    if (total + item.tokens > budget && current.length > 0) {
      batches.push(current);
      current = [];
      total = 0;
    }

    current.push(item);
    total += item.tokens;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}
```

**Step 4: 运行测试，确认通过**

Run: `pnpm -C packages/llm test -- batch-utils.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add packages/llm/src/summary/batch-utils.ts packages/llm/src/summary/batch-utils.test.ts
git commit -m "feat(llm): add token-budget batch grouping"
```

---

### Task 3: SummaryService 批量摘要与 JSON 容错

**Files:**
- Modify: `packages/llm/src/summary/service.ts`
- Modify: `packages/llm/src/summary/prompts.ts`
- Test: `packages/llm/src/summary/service.test.ts`

**Step 1: 写失败测试（JSON 解析失败 + 重试 2 次 + 置空）**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { SummaryService } from './service';

const fakeConfig = {
  provider: 'openai',
  base_url: 'http://localhost',
  api_key: 'x',
  model: 'gpt-test',
} as any;

describe('batch summary', () => {
  it('retries on invalid JSON and returns empty summaries', async () => {
    const service = new SummaryService(fakeConfig);
    const call = vi.spyOn(service as any, 'callLLM');
    call.mockResolvedValueOnce('not json');
    call.mockResolvedValueOnce('still wrong');
    call.mockResolvedValueOnce('also wrong');

    const result = await service.generateChunkSummariesBatch(
      [
        { id: 'c1', content: 'a' },
        { id: 'c2', content: 'b' },
      ],
      { timeoutMs: 10, maxRetries: 2 }
    );

    expect(result.map((r) => r.summary)).toEqual(['', '']);
    expect(call).toHaveBeenCalledTimes(3);
  });
});
```

**Step 2: 运行测试，确认失败**

Run: `pnpm -C packages/llm test -- service.test.ts`
Expected: FAIL（方法不存在或行为不符）

**Step 3: 写最小实现**

在 `prompts.ts` 增加 `BATCH_CHUNK_SUMMARY_PROMPT`，包含 JSON 输入/输出要求。

在 `service.ts`：
- 新增 `generateChunkSummariesBatch`，接收 `[{id, content}]`
- 生成批次时调用 `groupByTokenBudget`
- 调用 LLM 时使用 **严格 JSON 输出**
- `JSON.parse` 失败 → 追加新的 user message（错误信息 + 期望格式）→ 最多 2 次
- 超时或重试耗尽 → 该批次 summaries 全部置空

**Step 4: 运行测试，确认通过**

Run: `pnpm -C packages/llm test -- service.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add packages/llm/src/summary/service.ts packages/llm/src/summary/prompts.ts packages/llm/src/summary/service.test.ts
git commit -m "feat(llm): batch summary with json retry and empty fallback"
```

---

### Task 4: Indexer 中 summary 模式分流

**Files:**
- Modify: `packages/indexer/src/pipeline.ts`
- Test: `packages/indexer/src/pipeline.test.ts`

**Step 1: 写失败测试（skip 不触发 LLM）**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { runIndexPipeline } from './pipeline';

const fakeSummary = { generateChunkSummary: vi.fn(), generateChunkSummariesBatch: vi.fn() } as any;

describe('summary mode', () => {
  it('skips summaries when mode=skip', async () => {
    const result = await runIndexPipeline({
      summaryService: fakeSummary,
      summaryMode: 'skip',
    } as any);

    expect(fakeSummary.generateChunkSummariesBatch).not.toHaveBeenCalled();
    expect(result.chunkSummaries.every((s: string) => s === '')).toBe(true);
  });
});
```

**Step 2: 运行测试，确认失败**

Run: `pnpm -C packages/indexer test -- pipeline.test.ts`
Expected: FAIL（参数/行为不符）

**Step 3: 写最小实现**

在 `pipeline.ts`：
- 读取 `config.summary.mode` 与 `chunk_batch_token_budget`
- `skip`：chunk/document/directory summary 直接置空
- `batch`：调用 `generateChunkSummariesBatch`
- 保持 progress phase 的汇报

**Step 4: 运行测试，确认通过**

Run: `pnpm -C packages/indexer test -- pipeline.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add packages/indexer/src/pipeline.ts packages/indexer/src/pipeline.test.ts
git commit -m "feat(indexer): add summary mode routing"
```

---

### Task 5: 端到端验证（可选但建议）

**Files:**
- Modify: `docs/plans/2026-02-05-summary-batch-skip-design.md`

**Step 1: 本地跑索引（手动验证）**

Run: `pnpm -C packages/electron-app dev`
Expected: 目录索引速度明显提升（skip 模式）或 chunk summary 批量执行（batch 模式）

**Step 2: 更新计划文档（记录验证结果）**

在设计文档末尾补充验证结论。

**Step 3: 提交（如果更新文档）**

```bash
git add docs/plans/2026-02-05-summary-batch-skip-design.md
git commit -m "docs: record summary batch/skip verification"
```

---

## 完成标准

- summary.mode 可配置，默认 batch
- 批量按 token 预算切分，首次超预算即切批
- JSON 解析失败最多重试 2 次（追加 user message）
- 降级时 summary 置空
- indexer 流程不中断且 progress 正常


---

## 实施记录（2026-02-05）

- 已完成 Task 1-4。
- 单测执行：
  - `pnpm exec vitest run packages/core/src/config/schema.test.ts`
  - `pnpm exec vitest run packages/llm/src/summary/batch-utils.test.ts`
  - `pnpm exec vitest run packages/llm/src/summary/service.test.ts`
  - `pnpm exec vitest run packages/indexer/src/pipeline.test.ts`
- 说明：`pnpm -C packages/core test -- schema.test.ts` 与 `pnpm -C packages/llm test -- batch-utils.test.ts` 在当前 Vitest 配置下无法解析路径，改用 `pnpm exec vitest run ...`。
- E2E：未执行（可按需手动运行 Electron App 验证）。

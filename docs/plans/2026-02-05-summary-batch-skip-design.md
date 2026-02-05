# Summary Batch/Skip 设计文档

## 背景与问题

当前索引流程在 summary 阶段耗时明显，尤其是 chunk 数量较多时。用户需要支持两种模式：

- **skip**：完全跳过摘要生成
- **batch**：同一文档的多个 chunk 一次 LLM 请求生成摘要

默认模式为 **batch**，批次按 **token 预算约 10K** 分组，而不是固定数量。

---

## 目标

1. 支持 `summary.mode = batch | skip`（默认 batch）
2. 支持按 token 预算分批生成 chunk 摘要
3. 支持 JSON 输出解析容错与重试（最多 2 次）
4. 失败与降级时 summary 直接为空（不再用首段兜底）

---

## 配置设计

新增/扩展配置项（`packages/core/src/types/config.ts` + schema）：

```yaml
summary:
  mode: batch              # batch | skip
  chunk_batch_token_budget: 10000
  timeout_ms: 30000        # 单批次超时
  max_retries: 2           # 仅针对 JSON 解析失败的重试
```

- `mode` 默认 `batch`
- `chunk_batch_token_budget` 默认 10000（token 预算）
- `timeout_ms` 与 `max_retries` 可复用现有结构或新增

---

## 批量生成机制

### 批量分组

- 使用 tokenizer 统计每个 chunk 的 token 数
- 顺序累加，**当加入下一个 chunk 会超过预算时，就在“第一次超过预算”处切批**
- 若单个 chunk 自身超过预算，单独成批并记录 warning

### LLM 提示词输出

输入格式：

```json
[
  { "id": "chunk-1", "text": "..." },
  { "id": "chunk-2", "text": "..." }
]
```

要求输出：

```json
[
  { "id": "chunk-1", "summary": "..." },
  { "id": "chunk-2", "summary": "..." }
]
```

**强制只输出 JSON**，不允许额外文字。

### JSON 解析容错与重试

- 若解析失败：追加新的 user message，包含错误原因与期望格式
- 最多重试 2 次
- 超过重试次数或超时 → 该批次所有摘要置空字符串

---

## 模式行为

### skip 模式

- chunk/document/directory summary 全部置空字符串
- 不触发 LLM 请求
- 索引流程仍正常推进

### batch 模式

- 批量生成 chunk summaries
- 文档 summary/目录 summary 基于 chunk summaries（同样支持失败置空）

---

## 错误处理与日志

- JSON 解析失败与重试需要 log warning（含文件名/批次 id）
- 降级时 summary 置空，流程不中断
- timeout 或 retry 耗尽同样置空

---

## 测试策略

1. **配置层**：schema 默认值与 `mode` 校验
2. **分组逻辑**：验证“第一次超过预算即切批”
3. **JSON 容错**：模拟解析失败 → 追加 user message → 最多 2 次重试
4. **skip 模式**：确保不调用 LLM，summary 全为空

---

## 影响范围

- `packages/core`：配置类型与 schema
- `packages/llm`：summary batch 逻辑与 JSON 容错
- `packages/indexer`：summary 模式分流


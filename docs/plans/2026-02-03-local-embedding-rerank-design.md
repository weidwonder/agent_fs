# 本地 Embedding 与 Rerank 设计（Qwen3 0.6B）

**目标**
- 默认本地运行 Embedding 与 Rerank，降低外部依赖。
- Embedding 与 LLM 的 base_url / api_key 完全分离。
- 用户显式指定 embedding 时强制走 API。
- Rerank 默认本地，必要时可走 API，并可复用 embedding 的 URL/Token。
- 本地模型懒加载，并支持下载进度回调（桌面端需要）。

---

## 架构概览

```
SearchFusion
  ├─ VectorStore / BM25 召回
  ├─ RRF 融合
  └─ RerankService（可选，默认开启，可参数禁用）

@agent-fs/llm
  ├─ EmbeddingService
  │   ├─ LocalEmbeddingProvider（仅 Qwen3-Embedding-0.6B-ONNX）
  │   └─ APIEmbeddingProvider（OpenAI 兼容）
  └─ RerankService
      ├─ LocalRerankProvider（Qwen3-Reranker-0.6B）
      └─ APIRerankProvider（OpenAI 兼容）
```

---

## 配置原则

1. **Embedding 与 LLM 参数分离**
   - `llm.base_url/api_key` 仅用于摘要/对话。
   - `embedding.api.base_url/api_key` 仅用于向量。

2. **本地 Embedding 仅允许固定模型**
   - `embedding.default = local` 时，`embedding.local.model` 必须是
     `Qwen/Qwen3-Embedding-0.6B-ONNX`。
   - 若用户配置了 `embedding.api`，则无条件走 API。

3. **Rerank 默认本地，支持 API**
   - `rerank.default = local` 默认 `Qwen3-Reranker-0.6B`。
   - `rerank.api_inherit = true` 时，复用 `embedding.api` 的 URL/Token。
   - `rerank.api` 可单独覆盖。

---

## 数据流

1. **召回**
   - 向量检索（content/summary）与 BM25 召回并行。
   - RRF 融合得到候选集合。

2. **Rerank（默认开启，可禁用）**
   - 若 `useRerank=true` 且配置启用，使用交叉编码器重排候选。
   - 仅对 `topK * rerankMultiplier` 执行，控制成本。

3. **输出**
   - 返回最终 `topK`。
   - `meta` 标记 `rerankApplied`。

---

## 懒加载与进度回调

- Embedding/Rerank Provider 都采用 `initPromise`，首次调用时触发加载。
- 下载与加载事件通过可选回调上抛：
  - `onProgress({ phase: 'download' | 'load' | 'ready', percent?: number })`
- 若 transformers.js 无细粒度进度，则至少提供阶段性事件，保证 UI 有反馈。

---

## 错误处理与降级

- **Embedding 失败**：阻断索引与向量检索（必须失败）。
- **Rerank 失败**：降级为“无 rerank”，记录 warn，返回 `rerankApplied=false`。
- API 调用支持重试，超限后按上述策略处理。

---

## 测试范围

- Config 校验：本地模型白名单、embedding/llm 分离、rerank 复用。
- Provider 单测：Local/Remote Embedding、Local/Remote Rerank。
- SearchFusion 集成：`useRerank` 开关、rerank 排序效果。
- 端到端：索引与检索链路在本地模型下可运行。


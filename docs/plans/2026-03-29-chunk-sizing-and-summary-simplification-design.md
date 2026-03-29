# Chunk 大小与 Summary 简化设计文档

## 背景与问题

当前索引链路同时维护三层摘要：

- chunk summary
- document summary
- directory summary

这套设计在 chunk 较大时有一定价值，但当前项目已经具备以下特点：

- chunk 按 Markdown 结构切分
- 搜索结果会按文件聚合
- `get_chunk` 支持回看正文与邻居 chunk

在这个前提下，继续为每个 chunk 生成 summary，收益已经明显下降，代价则持续存在：

- 索引耗时更长
- LLM 请求更频繁，更容易触发限流
- 向量存储同时维护 `content_vector / summary_vector / hybrid_vector`，链路复杂
- 文档 summary 依赖 chunk summaries 聚合，摘要链路不够直接

同时，当前默认 chunk 大小为 `600-1200 tokens`，更偏向降低成本与保留大段语义，但对本地文档检索场景的精确定位不够友好。

---

## 目标

1. 将默认 chunk 大小从 `600-1200` 调整为 `400-800`
2. 保留现有 chunk 主流程逻辑，仅调整阈值
3. 彻底移除 chunk summary 生成、回填与依赖链路
4. 文档 summary 改为直接基于 `markdown` 生成
5. 当 `markdown` 超过 `10k token` 时，文档 summary 输入回退为“前 `1000 token` 正文 + 全部章节标题”
6. 目录 summary 继续保留，但仅依赖文档 summary / 子目录 summary
7. 搜索向量链路改为只依赖 `content_vector`
8. 不做兼容模式，不保留旧索引结构迁移逻辑

---

## 核心决策

### 1. Chunk 默认大小调整

默认配置改为：

```yaml
indexing:
  chunk_size:
    min_tokens: 400
    max_tokens: 800
```

原因：

- 相比 `600-1200`，更适合中文制度、合同、纪要、说明文档的局部定位
- 对“文件对了但代表段落偏泛”的问题更友好
- 仍然足够大，不至于把自然段和标题上下文切得过碎

### 2. Chunk 主流程不改

保留当前切分顺序：

1. 先按 Markdown 标题分节
2. 超过 `maxTokens` 时按句子或硬切分
3. 小于 `minTokens` 的 chunk 继续向后合并

本次改动只影响阈值，不改变主流程算法。

### 3. Summary 只保留文档级与目录级

本次改动后：

- chunk 不再生成 summary
- 文档继续生成 summary
- 目录继续生成 summary

原则是：

- chunk 是检索单元
- 文档 summary 是文件概括单元
- 目录 summary 是目录概括单元

---

## 文档 Summary 设计

### 正常路径

文档 summary 直接使用整篇 `markdown` 作为输入，不再依赖 chunk summaries 聚合。

### 超长回退路径

当 `countTokens(markdown) > 10000` 时，不再把整篇正文直接送入 LLM，而是构造压缩输入：

- `markdown` 前 `1000 token` 的正文
- `markdown` 中提取出的全部章节标题名称

建议输入形态：

```text
文档开头正文（前 1000 token）:
...

文档章节结构:
- 一级标题 A
- 二级标题 A.1
- 二级标题 A.2
- 一级标题 B
```

这样做的原因：

- 前 `1000 token` 往往覆盖引言、背景、定义、摘要、前置结论
- 全部标题可补充后半篇结构，避免“只看开头”导致的偏差
- 与“整篇硬塞入 prompt”相比，token 成本与稳定性更可控

### 标题提取

标题提取复用现有 Markdown AST 解析能力，不引入新的文档解析链路。

### 失败策略

文档 summary 调用失败时，不再从 chunk summary 回退。失败结果沿用当前简化策略，返回空字符串或最小退化结果。

---

## 目录 Summary 设计

目录 summary 继续使用已有目录聚合机制，但输入只来源于：

- 当前目录下文件的 document summary
- 子目录的 directory summary

目录层不再感知 chunk summary，也不再承担 chunk 级摘要回填职责。

---

## 索引与存储结构调整

### 向量存储

每个 chunk 仅保留：

- `content_vector`
- `chunk_id`
- `file_id`
- `dir_id`
- `chunk_line_start`
- `chunk_line_end`
- `locator`
- 其他必要定位元数据

移除：

- `summary_vector`
- `hybrid_vector`

搜索时直接基于 `content_vector` 检索。

### AFD 归档

继续保留：

- `content.md`
- `metadata.json`

调整 `summaries.json` 的语义，只保留文档级摘要，例如：

```json
{
  "documentSummary": "..."
}
```

不再写入 chunk 级摘要映射。

### 文件元数据

文件元数据中的 `summary` 字段继续保留，但其来源改为直接对 `markdown` 生成的文档摘要，而不是聚合 chunk summaries。

---

## 搜索链路调整

当前搜索设计包含 `content_vector + summary_vector` 的混合召回。改动后：

- 向量召回只使用 `content_vector`
- 不再构造或查询 `summary_vector / hybrid_vector`
- 关键词召回、文件聚合、代表 chunk 重选、`get_chunk` 回填逻辑保持不变

这样做的结果是：

- 向量链路更直接
- 查询成本更低
- 调试时更容易解释命中来源

---

## Summary Backfill 调整

“补全 Summary” 功能改为只处理：

- 文档 summary 缺失
- 目录 summary 缺失

不再处理：

- chunk summary 缺失扫描
- chunk summary 回写
- `summary_vector / hybrid_vector` 回填

---

## 迁移策略

项目当前处于早期阶段，本次不考虑兼容模式，也不做旧索引自动迁移。

结论：

- 旧索引结构视为失效
- 修改落地后需要重新索引
- 相关文档中应明确标注这是破坏性调整

---

## 影响范围

- `packages/core`
  - chunk 配置默认值
- `packages/core/chunker`
  - 无算法调整，仅依赖新阈值
- `packages/llm`
  - 删除 chunk summary 相关逻辑
  - 新增基于 markdown 的文档 summary 输入构造
- `packages/indexer`
  - 删除 chunk summary 调用
  - 文档 summary 改为直接基于 markdown
  - 向量写入只保留 `content_vector`
- `packages/search`
  - 搜索改为只使用 `content_vector`
- `Electron / MCP`
  - 只需跟随新的搜索返回链路与概览统计逻辑
- `docs`
  - 需求、架构、计划文档同步更新

---

## 测试策略

1. 配置默认值测试
   - `min_tokens=400`
   - `max_tokens=800`
2. chunk 行为测试
   - 验证主流程不变，只是阈值生效
3. 索引流程测试
   - 不再调用 chunk summary 生成
   - 文档 summary 改为直接使用 markdown
4. 超长文档测试
   - `markdown > 10000 tokens` 时，输入正确降级为“前 1000 token + 全部标题”
5. 向量存储测试
   - 只写入 `content_vector`
   - 不再出现 `summary_vector / hybrid_vector`
6. 搜索测试
   - 只走 `content_vector` 召回
7. backfill 测试
   - 仅补文档与目录 summary
8. 文档测试
   - 需求文档、架构文档、说明文档与实现保持一致

---

## 非目标

本次不包含：

- 保留 chunk summary 开关
- 兼容旧索引结构
- 为 document summary 单独建立新的文件级向量召回通道
- 重做目录 summary 算法


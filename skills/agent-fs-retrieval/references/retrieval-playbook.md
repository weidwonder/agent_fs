# Agent FS 检索打法

按需读取这份文件：仅当你需要改写 query、控制 scope、解释命中质量或排查低召回时再展开。

## 1. 默认顺序

1. `list-indexes`
2. `dir-tree` 或 `get-project-memory`
3. `search`
4. `get-chunk`

除非用户明确要求全局搜索，否则不要一上来跨所有项目盲搜。

## 2. 什么时候加 keyword

适用：

- 法规名
- 制度名
- 表头字段
- 会计科目
- 专有名词

打法：

- `query` 写意图
- `keyword` 放精确词
- 先看 `keyword_snippets`

## 3. 什么时候只用语义 query

适用：

- “如何做”
- “原因是什么”
- “有哪些步骤”
- “帮我总结”

打法：

- 把业务目标写进 `query`
- `keyword` 可空
- 如结果太散，再补范围或核心术语

## 4. Scope 策略

### 已知项目

- 先用项目根路径试一轮
- 结果太散时，再缩到子目录

### 已知目录

- 直接传该目录到 `--scope`
- 多个候选目录时，用多个 `--scope`

### 完全不知道范围

1. `list-indexes`
2. 选项目
3. `dir-tree --depth 1~2`
4. 在候选目录内检索

## 5. 文件对了但段落不对

按这个顺序处理：

1. 看 `keyword_snippets`
2. 看 `source.locator`
3. 跑 `get-chunk --include-neighbors`

不要因为代表 chunk 不准，就直接判定整次检索失败。

## 6. 结果判读

- `chunk_hits` 高：同一文件多点命中
- `aggregated_chunk_ids` 多：结果不是偶然单点命中
- `source.file_path`：先判断文件是否找对
- `source.locator`：再判断落点是否找对

## 7. 常见问题

### 结果为空

优先排查：

1. 项目是否已索引
2. `scope` 是否有效
3. `keyword` 是否过严
4. `query` 是否太短或太抽象

### 结果太多

优先修正：

1. 缩 `scope`
2. 降低 `top-k`
3. 把 query 改得更具体

### 找到文件但证据不够

优先修正：

1. 取高分结果的 `chunk_id`
2. 用 `get-chunk` 展开邻近上下文
3. 对照 `keyword_snippets` 核实关键词命中

## 8. 结构化文档

Excel、表格、表单类内容：

- 优先走关键词打法
- 优先看 `locator`
- 若用户给的是列名、指标名、sheet 名，优先写进 `keyword`

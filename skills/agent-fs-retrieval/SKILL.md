---
name: agent-fs-retrieval
description: 通过内置 CLI 调用 Agent FS MCP 服务，执行知识库检索、目录浏览、chunk 回查与项目 memory 读取。适用于需要直接检索 Agent FS、缩小 scope、优化 query 或 keyword、展开 chunk 上下文、解释低召回原因的场景。默认使用 skill 自带脚本，不暴露协议细节，除非用户明确要求调试 MCP。
---

# Agent FS Retrieval

## 适用场景

在这些场景使用这个 skill：

- 需要直接查询 Agent FS 知识库
- 需要先看项目或目录，再缩小检索范围
- 需要从搜索结果继续展开 chunk 上下文
- 需要解释“为什么没搜到”或“为什么结果太散”

不要把这个 skill 当成 Agent FS 内部实现说明。它的职责是优先通过内置 CLI 完成查询和回查，再把结果整理成对用户有用的结论。

## 默认行为

- 优先使用 `scripts/agent_fs_cli.py`
- 只有在本地服务不可达时，才尝试 `scripts/start-local-mcp.sh`
- 如果内置快捷子命令还没覆盖新工具，使用 `scripts/agent_fs_cli.py call-tool --name ... --arguments-json ...`
- 不要手写 `initialize`、`tools/call` 或其他 MCP 协议请求，除非用户明确要求排查协议层问题
- 不要向用户展开 Agent FS 的内部实现细节，除非这些细节就是用户问题的一部分
- 对用户输出时，优先给结论、证据和下一步检索动作，不要直接倾倒原始 JSON

## 工作流

### 1. 先确认服务状态

- 先跑 `health`
- 如果本地端点不可达，再尝试 `scripts/start-local-mcp.sh`
- 如果服务仍不可用，向用户明确说明阻塞点，不要假装检索已经完成

### 2. 先找项目，再找目录

- 用 `list-indexes` 找候选项目
- 需要理解目录结构时，使用 `dir-tree`
- 需要读取项目记忆或约定时，使用 `get-project-memory`
- 避免一上来跨全部项目盲搜

### 3. 用最小范围做第一轮搜索

- 已知项目时，先以项目根目录作为 `scope`
- 已知子目录时，直接缩到子目录
- 需要精确名词匹配时补 `keyword`
- 需要语义检索时把意图写进 `query`

### 4. 命中后继续展开证据

- 文件对了但段落不准时，使用 `get-chunk --include-neighbors`
- 需要确认是否稳定命中时，结合 `chunk_hits`、`aggregated_chunk_ids` 和 `source.locator` 判断
- 不要仅凭单个 chunk 就下过强结论

### 5. 输出给用户时保持收敛

- 先说找到了什么，没找到什么
- 再给关键证据，例如命中文件、定位行段、相邻上下文
- 最后给下一步建议，例如继续缩目录、补关键词、或展开 chunk

## 何时读取附加资料

- 需要精确命令格式、本地/云端切换方式、环境变量或子命令示例时，读取 `references/cli-usage.md`
- 需要设计检索策略、改写 query、控制 scope 或排查低召回时，读取 `references/retrieval-playbook.md`

## 内置脚本

### `scripts/agent_fs_cli.py`

统一封装 Agent FS MCP 调用。支持：

- `health`
- `tools-list`
- `call-tool`
- `list-indexes`
- `index-documents`
- `dir-tree`
- `search`
- `get-chunk`
- `get-project-memory`

支持环境变量：

- `AGENT_FS_MCP_URL`
- `AGENT_FS_MCP_TOKEN`

### `scripts/start-local-mcp.sh`

用于在当前仓库内启动本地 Agent FS MCP 服务，默认监听 `127.0.0.1:3001`。

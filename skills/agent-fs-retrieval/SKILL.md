---
name: agent-fs-retrieval
description: 通过内置 CLI 调用 Agent FS 知识库服务，执行知识库检索、目录浏览、chunk 回查、项目 memory 读取与云端文档导入。适用于需要直接检索 Agent FS、缩小 scope、优化 query 或 keyword、展开 chunk 上下文、解释低召回原因，以及在 local/cloud 两种后端之间切换的场景。
---

# Agent FS Retrieval

## 适用场景

在这些场景使用这个 skill：

- 需要直接查询 Agent FS 知识库
- 需要先看项目或目录，再缩小检索范围
- 需要从搜索结果继续展开 chunk 上下文
- 需要解释“为什么没搜到”或“为什么结果太散”
- 需要同时兼容本地服务与云端服务

不要把这个 skill 当成 Agent FS 内部实现说明。它的职责是优先通过内置 CLI 完成查询和回查，再把结果整理成对用户有用的结论。

## 默认行为

- 优先使用 `scripts/agent_fs_cli.py`
- 用户只给云端地址时，优先执行 `connect-cloud`
- 默认假定用户环境已就绪，先直接执行 `connect-cloud` / `probe` / `health` / 工具调用
- 处理云端连接时，不要先查看 CLI 帮助、不要先读脚本源码，先直接执行 `connect-cloud`
- 本地 endpoint 不可达时，才尝试 `scripts/start-local-service.sh`
- 只有在 endpoint 不可达、token 缺失、本地运行时缺失或本地索引数据未就绪时，才回退读取 `setup.md`
- 如果云端认证失败且用户提供了账号密码，优先使用 `login-cloud`
- 如果云端没有现成账号且允许新建账号，使用 `register-cloud`
- 只允许通过内置 CLI 和内置脚本访问服务
- 如果内置快捷子命令还没覆盖新工具，使用 `scripts/agent_fs_cli.py call-tool --name ... --arguments-json ...`
- 不要手写协议层请求，除非用户明确要求排查协议层问题
- 不要向用户展开 Agent FS 的内部实现细节，除非这些细节就是用户问题的一部分
- 对用户输出时，优先给结论、证据和下一步检索动作，不要直接倾倒原始 JSON

## 工作流

### 1. 先确认环境与 endpoint 类型

- 用户只给服务根地址时，直接跑 `connect-cloud`
- 其他情况先跑 `probe`
- 如果本地端点不可达，再尝试 `scripts/start-local-service.sh`
- 如果云端缺 token 或返回 `401`，先尝试 `login-cloud`
- 如果服务仍不可用，再读取 `setup.md` 定位缺失的 token、本地运行时或索引数据
- 如果服务仍不可用，向用户明确说明阻塞点，不要假装检索已经完成

### 2. 先识别引用语义，再调用工具

- `probe.profile.scope_reference_kind=path` 时，`scope` 传项目路径或目录路径
- `probe.profile.scope_reference_kind=id` 时，`scope` 传项目 ID 或目录 ID
- `probe.profile.project_reference_kind=mixed` 时，`get-project-memory --project` 同时可能接受项目 ID 或项目路径
- 云端专属工具例如 `index_documents`，只有在 `probe.profile.supports_index_documents=true` 时才调用

### 3. 先找项目，再找目录

- 用 `list-indexes` 找候选项目
- 需要理解目录结构时，使用 `dir-tree`
- 需要读取项目记忆或约定时，使用 `get-project-memory`
- 避免一上来跨全部项目盲搜

### 4. 用最小范围做第一轮搜索

- 已知项目时，先以项目根 scope 试一轮
- 已知子目录时，直接缩到子目录
- 需要精确名词匹配时补 `keyword`
- 需要语义检索时把意图写进 `query`

### 5. 命中后继续展开证据

- 文件对了但段落不准时，先检查 `probe.profile.supports_chunk_neighbors`
- 支持邻居参数时，使用 `get-chunk --include-neighbors`
- 不支持邻居参数时，只传 `chunk_id`
- 不要仅凭单个 chunk 就下过强结论

### 6. 输出给用户时保持收敛

- 先说找到了什么，没找到什么
- 再给关键证据，例如命中文件、定位行段、相邻上下文
- 最后给下一步建议，例如继续缩目录、补关键词、或展开 chunk

## 何时读取附加资料

- 默认不要读取 `references/cli-usage.md`；只有在 `connect-cloud` / `probe` / 工具调用出现非预期错误时才读取
- 只有在运行失败或环境不明确时，才读取 `setup.md`
- 需要设计检索策略、改写 query、控制 scope 或排查低召回时，读取 `references/retrieval-playbook.md`

## 内置脚本

### `scripts/agent_fs_cli.py`

统一封装 Agent FS 服务调用。支持：

- `health`
- `connect-cloud`
- `probe`
- `tools-list`
- `login-cloud`
- `register-cloud`
- `call-tool`
- `list-indexes`
- `index-documents`
- `dir-tree`
- `search`
- `get-chunk`
- `get-project-memory`

支持环境变量：

- `AGENT_FS_ENDPOINT`
- `AGENT_FS_TOKEN`
- `AGENT_FS_CREDENTIALS_FILE`

### `scripts/start-local-service.sh`

用于启动本地 Agent FS 服务，默认监听 `127.0.0.1:3001`。

启动优先级：

1. `AGENT_FS_LOCAL_START_CMD`
2. `AGENT_FS_LOCAL_BIN`
3. PATH 中的 Agent FS 本地命令
4. 当前仓库源码构建启动

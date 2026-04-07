# Agent FS Retrieval Setup

> 目的：当默认检索流程失败时，用这份文档补齐 Agent FS 知识库服务的运行条件。

## 0. 什么时候再看这份文档

默认情况下，先直接执行：

1. `probe`
2. `tools-list`
3. `list-indexes`

只有在以下情况之一发生时，再回到这份文档：

- endpoint 不可达
- token 缺失或认证失败
- 本地运行时缺失
- 本地索引数据未就绪
- local/cloud 的参数语义不明确

## 1. 先做环境探测

按这个顺序检查：

1. 是否已经提供 `AGENT_FS_ENDPOINT`
2. 是否已经提供 `AGENT_FS_TOKEN`
3. 是否已经提供 `AGENT_FS_CREDENTIALS_FILE`
4. 是否已经提供 `AGENT_FS_LOCAL_START_CMD`
5. 是否已经提供 `AGENT_FS_LOCAL_BIN`
6. PATH 中是否存在可用的 Agent FS 本地命令
7. 是否存在当前仓库源码，可用仓库内启动命令拉起本地服务

如果以上都不满足，不要假定本地服务可用，应明确告诉用户当前缺少本地运行时。

## 2. 云端模式

适用条件：

- 用户提供了云端地址
- 或已配置 `AGENT_FS_ENDPOINT`

最小配置：

```bash
export AGENT_FS_ENDPOINT="http://server-host:3000/<service-endpoint>"
export AGENT_FS_TOKEN="..."
```

如果没有 token，但用户有账号密码，优先直接执行：

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py \
  --endpoint "http://server-host:3000/<service-endpoint>" \
  login-cloud \
  --email "user@example.com" \
  --password "your-password"
```

如果云端还没有账号，并且当前环境允许注册，可执行：

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py \
  --endpoint "http://server-host:3000/<service-endpoint>" \
  register-cloud \
  --email "user@example.com" \
  --password "your-password" \
  --tenant-name "My Workspace"
```

如果没有显式 token，也可以使用凭证文件：

```bash
export AGENT_FS_CREDENTIALS_FILE="$HOME/.agent_fs/credentials.json"
```

凭证文件格式要求：

- 顶层是 JSON object
- key 通常是云端基础地址，例如 `http://server-host:3000`
- value 至少包含 `accessToken`

配置后先验证：

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py probe
```

## 3. 本地模式

适用条件：

- 用户要求连接本地知识库
- 或未提供云端地址，但主机上存在本地运行时

优先级从高到低：

### 3.1 外部注入启动命令

适合：

- 本地服务需要通过特定包装命令启动
- 运行时在自定义目录中

```bash
export AGENT_FS_LOCAL_START_CMD='"/path/to/agent-fs" serve --host=127.0.0.1 --port=3001'
```

### 3.2 指定本地二进制

适合：

- 已有解压后的本地运行时
- 不希望依赖 PATH

```bash
export AGENT_FS_LOCAL_BIN="/path/to/agent-fs"
```

### 3.3 PATH 中已有本地命令

无需额外配置，`start-local-service.sh` 会自动探测。

### 3.4 当前仓库源码启动

仅当：

- 当前目录就是 `agent_fs` 仓库
- 且已安装 `pnpm`

脚本会自动 fallback 到：

```bash
pnpm --filter <local-service-package> build
pnpm --filter <local-service-package> start --host=127.0.0.1 --port=3001
```

## 4. 本地数据前提

本地服务能启动，不代表本地检索一定可用。本地检索还依赖：

- `~/.agent_fs/registry.json`
- `~/.agent_fs/storage`
- 本地索引数据已存在
- 本地 embedding 配置与索引维度一致
- 原生依赖可正常加载

如果用户要求查本地库，但这些数据不存在，应明确说明“本地运行时已就绪，但本地索引数据未就绪”。

## 5. Hybrid 模式

同时需要 local + cloud 时：

```bash
export AGENT_FS_ENDPOINT="http://cloud-host:3000/<service-endpoint>"
export AGENT_FS_CREDENTIALS_FILE="$HOME/.agent_fs/credentials.json"
export AGENT_FS_LOCAL_BIN="/path/to/agent-fs"
```

使用建议：

1. 先对云端 endpoint 跑一次 `probe`
2. 再切到本地 endpoint 跑一次 `probe`
3. 根据 `probe.profile` 判断当前 scope 是路径还是 ID

## 6. 最小验证

无论 local 还是 cloud，完成 setup 后都至少跑：

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py probe
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py tools-list
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py list-indexes
```

## 7. 阻塞时怎么处理

- 缺 token：优先使用 `login-cloud`；如果没有现成账号且允许注册，则使用 `register-cloud`
- 缺本地运行时：优先让用户提供 `AGENT_FS_LOCAL_BIN` 或 `AGENT_FS_LOCAL_START_CMD`
- 缺本地索引数据：说明“服务可启动，但没有可检索知识库”
- local/cloud 工具语义不一致：先跑 `probe`，再按能力分支调用，不要硬套同一套参数

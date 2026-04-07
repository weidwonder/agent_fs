# Agent FS CLI 参考

按需读取这份文件：默认直接按这里的命令工作；只有在命令失败或环境不明确时，再回到 `setup.md` 做安装与排障。

## 1. 默认端点

- 服务端点: 由环境提供
- Health: `http://127.0.0.1:3001/health`

如果不显式传 `--endpoint`，CLI 会按以下顺序取值：

1. `--endpoint`
2. `AGENT_FS_ENDPOINT`
3. 默认值 `http://127.0.0.1:3001/<service-endpoint>`

## 2. 认证来源

CLI 会按以下顺序找 token：

1. `--token`
2. `AGENT_FS_TOKEN`
3. `--credentials-file`
4. `AGENT_FS_CREDENTIALS_FILE`
5. 默认凭证文件 `~/.agent_fs/credentials.json`

凭证文件按 endpoint 对应的基础地址匹配，例如：

- endpoint: `http://182.92.22.224:1202/<service-endpoint>`
- credentials key: `http://182.92.22.224:1202`

## 3. 命令模板

### 健康检查

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py health
```

### 探测 endpoint 类型与能力

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py probe
```

重点看：

- `profile.backend_kind`
- `profile.scope_reference_kind`
- `profile.project_reference_kind`
- `profile.supports_index_documents`
- `profile.supports_chunk_neighbors`

### 查看工具面

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py tools-list
```

### 云端登录

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py \
  --endpoint "http://server-host:3000/<service-endpoint>" \
  login-cloud \
  --email "user@example.com" \
  --password "your-password"
```

登录成功后，access token 和 refresh token 会保存到凭证文件。

### 云端注册

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py \
  --endpoint "http://server-host:3000/<service-endpoint>" \
  register-cloud \
  --email "user@example.com" \
  --password "your-password" \
  --tenant-name "My Workspace"
```

### 通用工具调用

当快捷子命令还没覆盖新工具时，直接走通用入口：

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py call-tool \
  --name "list_indexes" \
  --arguments-json '{}'
```

### 列出项目

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py list-indexes
```

### 从 URL 导入文档

仅在 `probe.profile.supports_index_documents=true` 时使用：

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py index-documents \
  --project "7a90237c-66de-4d50-a175-786312d70a75" \
  --url "https://gitee.com/mirrors/gitignore/raw/main/README.md"
```

### 读取目录树

本地路径型 scope 示例：

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py dir-tree \
  --scope "/path/to/project" \
  --depth 2
```

云端 ID 型 scope 示例：

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py dir-tree \
  --scope "7a90237c-66de-4d50-a175-786312d70a75" \
  --depth 2
```

### 搜索

路径型 scope 示例：

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py search \
  --scope "/path/to/project" \
  --query "查找企业所得税税率的规定" \
  --keyword "企业所得税税率" \
  --top-k 5
```

ID 型 scope 示例：

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py search \
  --scope "7a90237c-66de-4d50-a175-786312d70a75" \
  --query "金融工具减值" \
  --keyword "金融工具减值" \
  --top-k 5
```

### 读取 chunk 上下文

仅在 `probe.profile.supports_chunk_neighbors=true` 时追加邻居参数：

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py get-chunk \
  --chunk-id "file-id:0007" \
  --include-neighbors \
  --neighbor-count 3
```

不支持邻居参数时：

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py get-chunk \
  --chunk-id "file-id:0007"
```

### 读取项目 memory

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py get-project-memory \
  --project "7a90237c-66de-4d50-a175-786312d70a75"
```

## 4. 云端调用

云端场景覆盖端点和 token：

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py \
  --endpoint "http://server-host:3000/<service-endpoint>" \
  --token "$AGENT_FS_TOKEN" \
  probe
```

超时较长的调用可追加 `--timeout 180`。

## 5. 本地运行时相关环境变量

- `AGENT_FS_LOCAL_START_CMD`
- `AGENT_FS_LOCAL_BIN`
- `AGENT_FS_LOCAL_HOST`
- `AGENT_FS_LOCAL_PORT`

启动本地服务：

```bash
bash skills/agent-fs-retrieval/scripts/start-local-service.sh
```

## 6. 输出约定

- 默认输出格式化 JSON
- 工具调用错误时，脚本返回非 0，并把错误打印到 stderr
- `search` 的正文结果会自动把工具返回中的 JSON 文本解开，不需要手工二次解析

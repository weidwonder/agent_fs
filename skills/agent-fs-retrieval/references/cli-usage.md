# Agent FS CLI 参考

按需读取这份文件：仅当你需要精确命令格式、环境变量、本地或云端切换方式时再展开。

## 1. 默认端点

- MCP: `http://127.0.0.1:3001/mcp`
- Health: `http://127.0.0.1:3001/health`

本地服务不可达时：

```bash
bash skills/agent-fs-retrieval/scripts/start-local-mcp.sh
```

## 2. 命令模板

### 健康检查

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py health
```

### 查看工具面

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py tools-list
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

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py index-documents \
  --project "7a90237c-66de-4d50-a175-786312d70a75" \
  --url "https://gitee.com/mirrors/gitignore/raw/main/README.md"
```

### 读取目录树

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py dir-tree \
  --scope "/path/to/project" \
  --depth 2
```

### 搜索

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py search \
  --scope "/path/to/project" \
  --query "查找企业所得税税率的规定" \
  --keyword "企业所得税税率" \
  --top-k 5
```

多目录范围：

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py search \
  --scope "/path/to/project/税法体系" \
  --scope "/path/to/project/会计政策" \
  --query "查找递延所得税确认条件" \
  --top-k 5
```

### 读取 chunk 上下文

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py get-chunk \
  --chunk-id "file-id:0007" \
  --include-neighbors \
  --neighbor-count 3
```

### 读取项目 memory

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py get-project-memory \
  --project "/path/to/project"
```

## 3. 云端调用

云端场景覆盖端点和 token：

```bash
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py \
  --endpoint "http://server-host:3000/mcp" \
  --token "$AGENT_FS_MCP_TOKEN" \
  list-indexes
```

超时较长的调用可追加 `--timeout 180`。

也可使用环境变量：

```bash
export AGENT_FS_MCP_URL="http://server-host:3000/mcp"
export AGENT_FS_MCP_TOKEN="..."
python3 skills/agent-fs-retrieval/scripts/agent_fs_cli.py list-indexes
```

## 4. 输出约定

- 默认输出格式化 JSON
- 工具调用错误时，脚本返回非 0，并把错误打印到 stderr
- `search` 的正文结果会自动把 MCP `content[0].text` 里的 JSON 解开，不需要手工二次解析

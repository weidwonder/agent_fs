# MCP 客户端接入指南

> 配置 AI Agent 通过 MCP 协议连接 Agent FS 本地或云端知识库

---

## 概述

Agent FS 的本地版和云端都在 `/mcp` 路径暴露 Streamable HTTP MCP 端点，AI 客户端通过标准 MCP 协议即可调用搜索、浏览等工具。

| 模式 | 端点地址 | 认证 | 说明 |
|------|----------|------|------|
| 本地版 | `http://127.0.0.1:3001/mcp` | 无 | 需先手动启动本地 MCP 服务 |
| 云端 | `http://<server-host>:3000/mcp` | `Authorization: Bearer <access-token>` | 多租户 SaaS 部署 |

---

## 1. 启动本地 MCP 服务

本地版不再通过 `stdio` 由客户端按需拉起，而是作为独立的 HTTP 服务运行。

```bash
pnpm --filter @agent-fs/mcp-server build
pnpm --filter @agent-fs/mcp-server start
```

默认监听地址：

- MCP: `http://127.0.0.1:3001/mcp`
- Health: `http://127.0.0.1:3001/health`

如需自定义监听地址：

```bash
pnpm --filter @agent-fs/mcp-server start -- --host=0.0.0.0 --port=3101
```

---

## 2. 云端获取 Access Token

云端 MCP 请求需要携带 JWT access token。先通过 API 登录获取：

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "your-password"}'
```

从返回的 `accessToken` 字段取值。token 默认 15 分钟过期，需要定期通过 `/api/auth/refresh` 刷新。

> **提示：** 对于长时间运行的 AI Agent 场景，建议在外部脚本中自动刷新 token 并注入环境变量。

---

## 3. Claude Desktop 配置

编辑 Claude Desktop 的 MCP 配置文件：

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "agent-fs": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <your-access-token>"
      }
    }
  }
}
```

保存后重启 Claude Desktop，即可在对话中使用 Agent FS 的搜索工具。

本地版配置示例：

```json
{
  "mcpServers": {
    "agent-fs-local": {
      "url": "http://127.0.0.1:3001/mcp"
    }
  }
}
```

---

## 4. Claude Code (CLI) 配置

在项目根目录或全局 `~/.claude/settings.json` 中添加：

```json
{
  "mcpServers": {
    "agent-fs": {
      "type": "url",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <your-access-token>"
      }
    }
  }
}
```

本地版配置示例：

```json
{
  "mcpServers": {
    "agent-fs-local": {
      "type": "url",
      "url": "http://127.0.0.1:3001/mcp"
    }
  }
}
```

---

## 5. Cursor 配置

在 Cursor 设置中添加 MCP server：

1. 打开 Settings → MCP
2. 添加新的 MCP server：
   - Name: `agent-fs`
   - Type: `sse` 或 `streamable-http`
   - URL: `http://localhost:3000/mcp`
   - Headers: `Authorization: Bearer <your-access-token>`

本地版只需把 URL 改为 `http://127.0.0.1:3001/mcp`，并移除认证头。

---

## 6. 其他 MCP 客户端

任何支持 MCP Streamable HTTP 传输的客户端均可接入。关键参数：

| 参数 | 值 |
|------|-----|
| 传输协议 | Streamable HTTP (POST) |
| 端点 URL | `http://<host>:3000/mcp` |
| 认证 | 本地无；云端为 `Authorization: Bearer <token>` |
| Content-Type | `application/json` |

### 握手流程

MCP 客户端需先完成初始化握手：

> 注意：Streamable HTTP 请求需显式携带 `Accept: application/json, text/event-stream`，否则服务端会返回 `406`。

```bash
# Step 1: initialize
curl -X POST http://127.0.0.1:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "my-agent", "version": "1.0" }
    }
  }'

# Step 2: initialized notification
curl -X POST http://127.0.0.1:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "method": "notifications/initialized"
  }'

# Step 3: list available tools
curl -X POST http://127.0.0.1:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc": "2.0", "id": 2, "method": "tools/list"}'
```

---

## 7. 可用的 MCP 工具

| 工具 | 说明 | 关键参数 |
|------|------|---------|
| `list_indexes` | 列出所有已索引项目 | — |
| `dir_tree` | 展示目录结构 | `project_id`, `depth`(可选) |
| `glob_md` | 列出可读取的 Markdown 原文文件 | `scope`, `pattern`(可选), `limit`(可选) |
| `read_md` | 读取 Markdown 全文或指定行范围 | `scope`, `path`/`file_id`, `start_line`(可选), `end_line`(可选) |
| `grep_md` | 在 Markdown 原文里做精确文本搜索 | `scope`, `query`, `pattern`(可选), `context_lines`(可选) |
| `search` | 混合召回搜索 | `query`, `keyword`(可选), `scope`(可选), `top_k`(可选) |
| `get_chunk` | 获取 chunk 详情 | `chunk_id` |
| `get_project_memory` | 获取项目记忆 | `project_id` |
| `index_documents` | 从 URL 下载并索引 | `project_id`, `urls[]` |

### 搜索示例

```bash
curl -X POST http://127.0.0.1:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "search",
      "arguments": {
        "query": "如何配置数据库",
        "top_k": 5
      }
    }
  }'
```

---

## 8. Token 自动刷新

Access token 默认 15 分钟过期。对于需要长时间运行的 AI Agent，可编写简单的刷新脚本：

```bash
#!/bin/bash
# refresh-token.sh — 刷新 token 并输出新的 accessToken
REFRESH_TOKEN="eyJ..."
SERVER="http://localhost:3000"

NEW_TOKEN=$(curl -s -X POST "$SERVER/api/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}" \
  | jq -r '.accessToken')

echo "$NEW_TOKEN"
```

可将此脚本集成到 cron 或 AI Agent 的启动脚本中，定期更新配置文件中的 token。

---

## 9. 网络部署注意事项

### 内网部署

如果 Agent FS 和 AI 客户端在同一内网，直接使用内网 IP：

```
http://192.168.1.100:3000/mcp
```

### 公网暴露

生产环境建议通过反向代理（Nginx/Caddy）暴露，并启用 HTTPS：

```nginx
server {
    listen 443 ssl;
    server_name kb.example.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 支持
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
```

配置后 MCP 端点变为 `https://kb.example.com/mcp`。

---

## 常见问题

**Q: Token 过期后 MCP 请求报 401？**

A: 使用 refresh token 获取新的 access token，更新客户端配置并重启。

**Q: 本地版为什么连不上？**

A: 先确认本地 MCP 服务已经单独启动，再检查 `curl http://127.0.0.1:3001/health` 是否返回 `{"status":"ok"}`。

**Q: Claude Desktop 连接不上？**

A: 检查：(1) 服务是否在运行 `curl http://localhost:3000/health`；(2) 配置文件 JSON 格式是否正确；(3) token 是否有效。

**Q: 远程服务器连接超时？**

A: 确认防火墙已开放端口（默认 3000），且服务绑定地址为 `0.0.0.0`（默认已是）。

**Q: MCP 可以无认证使用吗？**

A: 不可以。JWT 认证是必需的，用于识别用户和租户以实现数据隔离。

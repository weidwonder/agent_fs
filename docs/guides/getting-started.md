# 快速上手指南

> 从零开始使用 Agent FS 云端知识库：注册、建库、上传、搜索

前置条件：已按 [云端部署指南](cloud-deployment.md) 完成部署，服务运行在 `http://localhost:3000`。

---

## 1. 注册账户

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "your-password",
    "tenantName": "我的团队"
  }'
```

返回：

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "user": { "id": "...", "email": "user@example.com" },
  "tenant": { "id": "...", "name": "我的团队" }
}
```

记下 `accessToken`，后续请求都需要它。也可以直接访问 `http://localhost:3000` 使用 Web UI 注册。

---

## 2. 登录（已有账户）

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "your-password"}'
```

返回同上。`accessToken` 默认 15 分钟过期，使用 `refreshToken` 续期：

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "eyJ..."}'
```

---

## 3. 创建知识库项目

```bash
export TOKEN="eyJ..."  # 替换为你的 accessToken

curl -X POST http://localhost:3000/api/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "技术文档库", "description": "团队技术文档集合"}'
```

返回：

```json
{
  "id": "project-uuid",
  "name": "技术文档库",
  "description": "团队技术文档集合"
}
```

---

## 4. 上传文档

支持 PDF、DOCX、XLSX、Markdown 格式，可一次上传多个文件。

```bash
curl -X POST http://localhost:3000/api/projects/<project-id>/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/document.pdf" \
  -F "file=@/path/to/notes.md"
```

返回 `202 Accepted`，表示文件已接收并开始异步索引。

### 查看索引进度

```bash
# 方式一：轮询文件列表
curl http://localhost:3000/api/projects/<project-id>/files \
  -H "Authorization: Bearer $TOKEN"

# 方式二：SSE 实时推送（每 2 秒更新）
curl -N http://localhost:3000/api/projects/<project-id>/indexing-events \
  -H "Authorization: Bearer $TOKEN"
```

文件状态流转：`pending` → `indexing` → `indexed`（成功）/ `failed`（失败）。

---

## 5. 搜索

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "如何配置数据库连接",
    "topK": 5
  }'
```

### 搜索参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 语义查询文本 |
| `keyword` | string | 否 | 精准关键词匹配（BM25） |
| `scope` | string/string[] | 否 | 限定搜索范围：项目 ID 或目录 ID 列表 |
| `topK` | number | 否 | 返回结果数，默认 10 |

搜索引擎同时使用向量语义匹配和 BM25 关键词匹配，通过 RRF 算法融合排序。中文查询会自动分词。

### 搜索结果示例

```json
{
  "results": [
    {
      "chunkId": "chunk-uuid",
      "score": 0.85,
      "content": "数据库连接配置通过 DATABASE_URL 环境变量...",
      "filePath": "deployment-guide.md",
      "locator": "## 配置 > 数据库"
    }
  ]
}
```

---

## 6. 使用 Web UI

访问 `http://localhost:3000` 即可使用图形界面，功能包括：

- 注册 / 登录
- 创建和管理项目
- 拖拽上传文档（支持多文件）
- 实时查看索引进度
- 搜索并浏览结果

---

## 7. 通过 MCP 让 AI Agent 使用知识库

这是 Agent FS 的核心场景——让 AI Agent 直接检索你的文档。

详细的 MCP 接入配置请参考 [MCP 客户端接入指南](mcp-client-integration.md)。

快速验证 MCP 是否可用：

```bash
# 列出可用工具
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## 下一步

- [MCP 客户端接入指南](mcp-client-integration.md) — 配置 Claude Desktop / Cursor 等 AI 工具
- [云端部署指南](cloud-deployment.md) — 生产环境部署与配置
- [运维手册](operations.md) — 备份、监控、扩容

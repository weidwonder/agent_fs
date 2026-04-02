# 云端部署指南

> Agent FS 云端知识库（SaaS 模式）部署与运维参考

架构设计详见 [架构文档 §11](../architecture.md#11-云端架构saas-模式)，需求详见 [需求文档 §13](../requirements.md#13-云端知识库saas-模式)。

---

## 1. 前置条件

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| Docker + Docker Compose | 24+ | 容器化部署 |
| Node.js | 20+ | 本地开发时需要 |
| pnpm | 9+ | 本地开发依赖管理 |
| PostgreSQL | 16+（含 pgvector） | 使用 `pgvector/pgvector:pg16` 镜像 |
| MinIO / S3 | — | 文档归档存储 |

---

## 2. 快速启动（Docker Compose 一键部署）

```bash
cd docker
cp .env.example .env
# 编辑 .env，修改 POSTGRES_PASSWORD / S3_SECRET_KEY / JWT_SECRET
docker compose up --build -d
```

启动后自动完成：
1. PostgreSQL + pgvector 就绪
2. MinIO 启动并创建默认 bucket（`agentfs`）
3. 执行数据库 migration（`001-init-schema.sql`）
4. 启动 `server`（HTTP API + MCP，端口 3000）
5. 启动 `worker`（索引任务消费者）

访问：
- Web UI：`http://localhost:3000`
- API：`http://localhost:3000/api/`
- MinIO 控制台：`http://localhost:9001`（默认账号 `minioadmin`）

停止：

```bash
docker compose down          # 保留数据卷
docker compose down -v       # 同时删除数据卷（不可恢复）
```

---

## 3. 开发环境搭建

开发模式下仅用 Docker 启动基础设施，server/worker 在宿主机热更新运行。

```bash
# 1. 启动基础设施（PostgreSQL + MinIO）
cd docker
docker compose -f docker-compose.dev.yml up -d

# 2. 等待 PostgreSQL 就绪后执行 migration
DATABASE_URL=postgresql://dev:dev@localhost:5432/agentfs_dev \
  ./init-db.sh

# 3. 安装依赖
cd ..
pnpm install

# 4. 编译所有包
pnpm -r build

# 5. 启动 server（另开终端）
DATABASE_URL=postgresql://dev:dev@localhost:5432/agentfs_dev \
S3_ENDPOINT=http://localhost:9000 \
S3_ACCESS_KEY=minioadmin \
S3_SECRET_KEY=minioadmin \
S3_BUCKET=agentfs \
JWT_SECRET=dev-secret \
  node packages/server/dist/index.js --mode=server

# 6. 启动 worker（另开终端，同上 env）
  node packages/server/dist/index.js --mode=worker
```

开发数据库连接信息（`docker-compose.dev.yml` 默认值）：

| 参数 | 值 |
|------|----|
| host | `localhost:5432` |
| user | `dev` |
| password | `dev` |
| database | `agentfs_dev` |
| MinIO | `localhost:9000`，账号 `minioadmin` |

---

## 4. 环境变量参考

所有变量均在 `packages/server/src/config.ts` 中定义，可通过 `.env` 或系统环境注入。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | HTTP 监听端口 |
| `HOST` | `0.0.0.0` | HTTP 监听地址 |
| `DATABASE_URL` | `postgresql://localhost:5432/agent_fs` | PostgreSQL 连接串 |
| `S3_ENDPOINT` | `http://localhost:9000` | S3/MinIO 服务地址 |
| `S3_BUCKET` | `agent-fs` | S3 存储桶名称 |
| `S3_ACCESS_KEY` | `minioadmin` | S3 访问密钥 |
| `S3_SECRET_KEY` | `minioadmin` | S3 秘密密钥 |
| `JWT_SECRET` | `change-me-in-production` | JWT 签名密钥，**生产环境必须修改** |
| `JWT_EXPIRES_IN` | `15m` | Access token 有效期 |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh token 有效期 |

**生产环境必须修改：** `POSTGRES_PASSWORD`、`S3_SECRET_KEY`、`JWT_SECRET`。

Embedding 相关配置通过全局 `~/.agent_fs/config.yaml`（或环境变量）注入，详见 [代码规范](code-standards.md)。

若使用 OpenAI 兼容 embedding 接口，建议显式设置：

```env
EMBEDDING_BATCH_SIZE=24
```

原因：

- 部分兼容接口对 `/embeddings` 的单次 `input[]` 条数限制比 OpenAI 官方更严
- 当前线上 `embedding-2` 经实测 `32` 条一批会触发 `400 / 1210`，`24` 条一批可稳定通过

---

## 5. 数据库 Migration

初始 schema 位于 `packages/storage-cloud/src/migrations/001-init-schema.sql`，包含：
- `users` / `tenants` / `tenant_members` / `api_keys`（用户与多租户）
- `projects` / `directories` / `files`（知识库结构）
- `chunks`（pgvector，向量维度懒加载）
- `inverted_terms` / `inverted_stats`（应用层 BM25 倒排索引）

**Docker Compose 部署** 会在 server 启动前自动执行 migration。

**手动执行 migration：**

```bash
# 方式一：使用 init-db.sh（需要 psql 命令）
DATABASE_URL=postgresql://agentfs:changeme@localhost:5432/agentfs \
  docker/init-db.sh

# 方式二：直接 psql
psql $DATABASE_URL \
  -f packages/storage-cloud/src/migrations/001-init-schema.sql
```

Migration 是幂等的（全部使用 `CREATE ... IF NOT EXISTS`），可安全重复执行。

---

## 6. Server 与 Worker 模式

同一镜像通过 `--mode` 参数区分角色：

```bash
# Server 模式（默认）：处理 HTTP API + MCP
node packages/server/dist/index.js --mode=server

# Worker 模式：消费 pg-boss 队列，执行文档索引任务
node packages/server/dist/index.js --mode=worker
```

| 模式 | 职责 | 对外端口 |
|------|------|---------|
| `server` | HTTP API + Web UI + MCP endpoint | `PORT`（默认 3000） |
| `worker` | 后台索引任务（pg-boss 消费者） | 无 |

Server 可水平扩展（无状态），Worker 可独立扩展。两者共享同一 PostgreSQL 与 MinIO。

---

## 7. 架构概览

```
用户 / AI Agent
      │
      ▼
  Nginx (可选反向代理)
      │
  ┌───┴───┐
  │ Server│  ── HTTP API + Web UI + POST /mcp
  └───┬───┘
      │ pg-boss 入队
  ┌───┴───┐
  │Worker │  ── 拉取队列 → 调用 Indexer
  └───┬───┘
      │
  ┌───┴──────────┐
  │ PostgreSQL   │  vectors(pgvector) + BM25 + metadata
  │ MinIO / S3   │  文档归档（AFD 内容）
  └──────────────┘
```

核心逻辑（`indexer` / `search` / `llm`）在 server 与 worker 之间共享，通过 `StorageAdapter` 接口与后端解耦。

---

## 8. API 路由

所有业务路由均在 `/api` 前缀下，需携带 `Authorization: Bearer <token>` header。

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册（邮箱/密码/租户名） |
| POST | `/api/auth/login` | 登录，返回 `accessToken` + `refreshToken` |
| POST | `/api/auth/refresh` | 刷新 access token |

### 项目管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/projects` | 列出当前租户项目 |
| POST | `/api/projects` | 创建项目 |
| GET | `/api/projects/:id` | 获取项目详情 |
| DELETE | `/api/projects/:id` | 删除项目 |

### 文档管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/projects/:projectId/upload` | 上传文档（multipart，支持多文件），返回 202 并异步索引 |
| GET | `/api/projects/:projectId/files` | 列出项目文件及索引状态 |
| DELETE | `/api/files/:fileId` | 删除文件 |

### 搜索

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/search` | 语义 + 关键词混合搜索 |

`/api/search` 请求体：

```json
{
  "query": "语义查询文本",
  "keyword": "精准关键词（可选）",
  "scope": "projectId 或 [dirId, ...]（可选）",
  "topK": 10
}
```

### 索引进度（SSE）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/projects/:projectId/indexing-events` | SSE 推送索引状态，每 2s 推送一次文件列表 |

### 其他

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查，返回 `{"status":"ok"}` |

---

## 9. MCP 接入

MCP endpoint 路径为 `/mcp`（不在 `/api` 前缀下），使用 JSON-RPC 2.0 over HTTP，需携带 JWT token。

```bash
# 工具列表（便捷接口）
curl -H "Authorization: Bearer <token>" \
     http://localhost:3000/mcp/tools

# 调用 MCP 工具
curl -X POST http://localhost:3000/mcp \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": 1,
       "method": "tools/call",
       "params": {
         "name": "search",
         "arguments": { "query": "文档主题" }
       }
     }'
```

**支持的 MCP 工具：**

| 工具 | 说明 |
|------|------|
| `list_indexes` | 列出所有已索引项目 |
| `dir_tree` | 展示目录结构（支持 `depth` 参数） |
| `search` | 混合召回搜索（`query` + 可选 `keyword` / `scope` / `top_k`） |
| `get_chunk` | 获取指定 chunk 详情 |
| `get_project_memory` | 获取项目 memory 内容 |
| `index_documents` | 从 URL 下载并触发索引（`project_id` + `urls[]`） |

MCP 握手流程：先发 `initialize` 方法，收到响应后发 `notifications/initialized`，然后正常调用 `tools/list` / `tools/call`。

---

## 10. 监控与健康检查

```bash
# 基本健康检查
curl http://localhost:3000/health
# 返回: {"status":"ok"}

# 索引进度监听（SSE）
curl -N -H "Authorization: Bearer <token>" \
     http://localhost:3000/api/projects/<projectId>/indexing-events
```

SSE 事件格式（每 2s 推送）：

```json
{
  "files": [
    { "id": "uuid", "name": "doc.pdf", "status": "indexed", "chunk_count": 42, "indexed_at": "..." }
  ]
}
```

文件 `status` 值：`pending` → `indexing` → `indexed` / `failed`。

---

## 11. 常见问题

**nodejieba 构建失败**

`nodejieba` 需要 Python 3、make、g++。Dockerfile 已包含这些构建工具。本地开发时确认系统已安装：

```bash
# macOS
xcode-select --install
# Ubuntu/Debian
sudo apt-get install -y python3 make g++
```

**Embedding 未配置导致索引失败**

Server 启动时会初始化 `EmbeddingService`。若未配置本地 Embedding 模型或 API 端点，上传文件后索引任务会失败。检查 `~/.agent_fs/config.yaml` 中的 `embedding` 配置，或设置对应环境变量。

**向量维度不匹配**

`chunks` 表的 `content_vector` 列维度在首次插入时由 `CloudVectorStoreAdapter.ensureVectorIndex()` 懒加载确定。切换 Embedding 模型后若维度不同，需清空 `chunks` 表并重新索引（或重建数据库）。

**DOCX / XLSX 文件未被索引**

DOCX/XLSX 插件依赖 .NET 8 运行时。默认 Docker 镜像未包含 .NET，相关文件会跳过处理。需要时按 `Dockerfile` 注释中的指引安装 `dotnet-runtime-8.0`。

**Worker 无任务消费**

检查 worker 与 server 是否使用相同的 `DATABASE_URL`（pg-boss 队列基于 PostgreSQL）。确认 migration 已执行。

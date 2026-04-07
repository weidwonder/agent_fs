# Cloud Knowledge Base Design Spec

> Agent FS 云端多租户知识库重构设计

## 1. 目标

将 Agent FS 从纯本地桌面应用重构为可在 Linux 服务器上运行的多租户 SaaS 云知识库，同时保留 Electron 本地版。

## 2. 核心决策

| 维度 | 决策 |
|------|------|
| 场景 | 多租户 SaaS |
| 文档入口 | Web UI 上传（优先）+ MCP 触发索引 |
| MCP 传输 | Streamable HTTP（本地 + 云端） |
| 认证 | 自建用户系统（JWT），预留 OAuth / API Key |
| 桌面端 | 保留 Electron 本地版，云端另做 Web UI，两者并行 |
| 存储 | 云端：pgvector + PG FTS + S3/MinIO；本地：保持 LanceDB + SQLite + AFD |
| 架构 | 存储抽象层（Storage Adapter），核心逻辑只有一份 |

## 3. Monorepo 包结构

```
packages/
├── core/                 # 保持 — 类型、配置、工具函数
├── indexer/              # 重构 — 通过 StorageAdapter 写入
├── search/               # 重构 — 通过 StorageAdapter 读取
├── llm/                  # 保持 — Embedding / Summary
├── plugins/              # 保持 — 文档处理插件
├── storage/              # 保持 — AFD Rust N-API（本地适配器依赖）
│
├── storage-adapter/      # 🆕 存储抽象层（接口定义 + LocalAdapter）
├── storage-cloud/        # 🆕 CloudAdapter（pgvector + PG FTS + S3）
├── server/               # 🆕 HTTP API + MCP Streamable HTTP
├── web-app/              # 🆕 React Web UI
│
├── mcp-server/           # 保持 — 本地 MCP Streamable HTTP 服务
├── electron-app/         # 保持 — 桌面客户端
└── e2e/                  # 保持
```

关键变化：
- `storage-adapter` 定义统一接口，内置 `LocalAdapter`（包装现有 LanceDB/SQLite/AFD）
- `storage-cloud` 实现 `CloudAdapter`（pgvector + PG FTS + S3）
- `indexer` 和 `search` 不再直接 import LanceDB/SQLite，改为依赖 `storage-adapter` 接口
- `server` 同时承担 HTTP API 和 MCP Streamable HTTP
- `mcp-server` 保留为本地独立 MCP Streamable HTTP 服务，供本地 AI 客户端接入

## 4. Storage Adapter 接口

> **冻结版本**（来源：`packages/storage-adapter/src/types.ts`）

```typescript
interface VectorSearchParams {
  vector: number[];
  dirIds: string[];
  topK: number;
  /** 本地实现使用 postfilter/prefilter 策略；云端实现可忽略此字段 */
  mode?: 'prefilter' | 'postfilter';
  minResultsBeforeFallback?: number;
}

interface VectorSearchResult {
  chunkId: string;
  score: number;
  document: VectorDocument;
}

interface VectorStoreAdapter {
  init(): Promise<void>;
  addDocuments(docs: VectorDocument[]): Promise<void>;
  searchByVector(params: VectorSearchParams): Promise<VectorSearchResult[]>;
  getByChunkIds(chunkIds: string[]): Promise<VectorDocument[]>;
  deleteByFileId(fileId: string): Promise<void>;
  deleteByDirId(dirId: string): Promise<void>;
  deleteByDirIds(dirIds: string[]): Promise<void>;
  close(): Promise<void>;
}

interface InvertedIndexEntry {
  text: string;
  chunkId: string;
  locator: string;
}

interface InvertedSearchResult {
  chunkId: string;
  score: number;
  locator: string;
}

interface InvertedIndexAdapter {
  init(): Promise<void>;
  addFile(fileId: string, dirId: string, entries: InvertedIndexEntry[]): Promise<void>;
  search(params: { terms: string[]; dirIds: string[]; topK: number }): Promise<InvertedSearchResult[]>;
  removeFile(fileId: string): Promise<void>;
  removeDirectory(dirId: string): Promise<void>;
  removeDirectories(dirIds: string[]): Promise<void>;
  close(): Promise<void>;
}

interface DocumentArchiveAdapter {
  write(fileId: string, content: { files: Record<string, string> }): Promise<void>;
  read(fileId: string, fileName: string): Promise<string>;
  readBatch(fileId: string, fileNames: string[]): Promise<Record<string, string>>;
  exists(fileId: string): Promise<boolean>;
  delete(fileId: string): Promise<void>;
  close(): Promise<void>;
}

interface MetadataAdapter {
  readIndexMetadata(dirId: string): Promise<IndexMetadata | null>;
  writeIndexMetadata(dirId: string, metadata: IndexMetadata): Promise<void>;
  deleteIndexMetadata(dirId: string): Promise<void>;
  listSubdirectories(dirId: string): Promise<{ dirId: string; relativePath: string; summary?: string }[]>;
  listProjects(): Promise<{ projectId: string; name: string; rootDirId: string; summary?: string }[]>;
  readProjectMemory(projectId: string): Promise<{ memoryPath: string; projectMd: string; files: { name: string; size: number }[] } | null>;
  writeProjectMemoryFile(projectId: string, fileName: string, content: string): Promise<void>;
}

/**
 * 工厂函数只组装对象，不做 I/O。
 * 调用方必须显式调 init() 和 close()。
 */
interface StorageAdapter {
  vector: VectorStoreAdapter;
  invertedIndex: InvertedIndexAdapter;
  archive: DocumentArchiveAdapter;
  metadata: MetadataAdapter;
  init(): Promise<void>;
  close(): Promise<void>;
}
```

### 接口设计决策

| 排除项 | 理由 |
|--------|------|
| `softDelete` / `compact` / `countRows` | 本地 LanceDB 维护操作，不属于主链路；Electron 直接调用 `VectorStore` 实例 |
| `updateFilePaths` | 云端不使用路径语义，目录移动/重命名仅限本地场景 |
| `filePathPrefix`（VectorSearchParams） | 所有 scope 必须在调用前解析为 `dirIds`；Phase 2 确保 MCP search 的路径回退场景仍可工作 |
| `DocumentArchiveAdapter` 使用 `fileId` 而非 `dirPath+fileName` | 本地实现：`fileId` 映射 AFD 文件路径；云端实现：`fileId` 映射 S3 key，两种实现统一签名 |
| 工厂函数不做 I/O | `init()` / `close()` 由调用方显式管理生命周期，便于测试和资源控制 |

**LocalAdapter**：包装现有 LanceDB VectorStore、SQLite InvertedIndex、AFD Storage、本地 JSON 文件。

**CloudAdapter**：
- `vector` → PostgreSQL + pgvector（`chunks` 表，HNSW 索引）
- `invertedIndex` → PostgreSQL 全文检索（应用层分词 + tsvector）
- `archive` → S3/MinIO（key = `{tenantId}/{fileId}.afd`）
- `metadata` → `projects` / `directories` / `files` 表 + S3 memory 前缀

云端 `IndexMetadata`（index.json）存入 `directories` 表，`Registry` 由 `tenants` + `projects` 表替代。

## 5. 多租户数据模型

```sql
-- 用户与租户
users (id UUID PK, email UNIQUE, password_hash, created_at)
tenants (id UUID PK, name, owner_id → users, storage_quota_bytes, created_at)
tenant_members (tenant_id → tenants, user_id → users, role, PK(tenant_id, user_id))

-- 知识库结构
projects (id UUID PK, tenant_id → tenants, name, config JSONB, created_at)
directories (id UUID PK, project_id → projects, parent_dir_id → directories, relative_path, summary, metadata JSONB, UNIQUE(project_id, relative_path))
files (id UUID PK, directory_id → directories, name, hash, size_bytes, chunk_count, summary, afd_key, indexed_at)

-- 向量存储
chunks (id TEXT PK, file_id → files, dir_id → directories, tenant_id → tenants, chunk_line_start, chunk_line_end, locator, content_vector vector(1024), indexed_at)
-- HNSW index on content_vector, B-tree on dir_id, file_id

-- 倒排索引
inverted_entries (id BIGSERIAL PK, file_id → files, dir_id → directories, tenant_id → tenants, term, chunk_id, locator, tf, positions INT[])
-- Index on (term, dir_id), (file_id)
```

## 6. 认证

- JWT：access_token（短期）+ refresh_token（长期）
- MCP：Streamable HTTP 请求头 `Authorization: Bearer <jwt>`
- 租户隔离：所有查询自动注入 `tenant_id`，中间件层强制执行
- 预留：`users` 表加 `oauth_provider/oauth_id` 支持 OAuth；新增 `api_keys` 表支持 API Key

## 7. HTTP Server

### 技术选型
- HTTP 框架：Fastify
- 任务队列：pg-boss（基于 PostgreSQL）
- MCP 传输：`@modelcontextprotocol/sdk` StreamableHTTPServerTransport

### 路由结构
```
POST /auth/register, /auth/login, /auth/refresh
CRUD /projects
POST /projects/:id/upload          # 文件上传
POST /search                       # HTTP API 搜索
POST /mcp                          # MCP Streamable HTTP 端点
GET  /projects/:id/indexing-events  # SSE 索引进度
```

### 文档上传 → 索引流程
```
用户上传 → S3 临时路径 → IndexingJob 入队(pg-boss)
    → Worker: 下载 → 插件转换 → chunk → embedding → summary
    → CloudAdapter 写入 pgvector/PG FTS/S3
    → 更新 files 表，SSE 通知前端
```

### MCP 工具
保持现有 5 个工具 + 新增 `index_documents`（接受文件 URL 列表，走 indexing queue）。

### Server/Worker 模式
同一份代码，通过启动参数切换：
- `--mode=server`：HTTP API + MCP
- `--mode=worker`：pg-boss 消费者，执行索引任务

## 8. Web UI

React + Vite + TailwindCSS。

| 页面 | 功能 |
|------|------|
| 登录/注册 | 邮箱密码认证 |
| 项目列表 | 查看/创建/删除知识库项目 |
| 项目详情 | 文件列表、上传、索引状态、概况 |
| 搜索 | 语义+关键词搜索，范围选择 |
| 设置 | LLM/Embedding 配置、成员管理 |

索引进度通过 SSE 推送。

## 9. 部署

```
Nginx (反向代理)
    ├── Server × N (API + MCP, 无状态可扩展)
    ├── Worker × N (索引任务消费者)
    ├── PostgreSQL (pgvector)
    └── MinIO/S3
```

Docker Compose 一键启动。

### 原生依赖
- AFD (Rust N-API) → 云端不需要，CloudAdapter 用 S3
- nodejieba → Docker 镜像预装（应用层分词）
- .NET 转换器 → Docker 镜像预装 dotnet runtime

### 配置管理
- 本地版：`~/.agent_fs/config.yaml` 不变
- 云端：环境变量优先（`DATABASE_URL`、`S3_ENDPOINT`、`JWT_SECRET`），支持 `.env`
- 租户级配置：`tenants.config` JSONB

## 10. 不在本次范围

- 自动文件变化监测（仍为手动触发）
- 图片/音视频索引
- 计费系统
- 公网 HTTPS 证书管理（由运维负责）

---

*Spec 版本: 1.0*
*创建日期: 2026-03-30*

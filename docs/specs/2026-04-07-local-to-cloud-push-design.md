# Local-to-Cloud Push Design Spec

> 本地索引数据直接推送到云端，跳过重新解析文档

## 1. 目标

提供 CLI 命令 `agent-fs push`，将本地已索引的 Project 数据推送到云端已有项目，无需重新解析文档、切片。如果 embedding 模型一致，向量也直接迁移；不一致则云端异步重新生成向量。

## 2. 核心决策

| 维度 | 决策 |
|------|------|
| 触发方式 | CLI 命令 `agent-fs push` |
| 迁移粒度 | 整个 Project |
| 目标确定 | 手动指定云端已存在的项目 ID |
| 认证 | 交互式 `agent-fs login`，JWT 缓存本地，CLI 场景 3 天有效期 |
| Embedding 兼容 | 自动检测；一致时携带向量，不一致时云端异步 re-embed |
| 推送粒度 | 按文件逐个推送，单文件所有数据在一个请求内 |
| CLI 位置 | `packages/mcp-server`（已是本地入口程序） |

## 3. 整体架构

```
agent-fs push --target <url> --project <project-id> [path]

本地 CLI                              云端 Server
─────────                            ─────────
1. 读取 credentials.json 获取 token
2. 验证本地 .fs_index/index.json
3. GET /embedding-info 检查兼容性
4. LocalAdapter 遍历文件：
   ├─ LanceDB → VectorDocument[]
   ├─ SQLite  → InvertedEntry[]
   └─ AFD     → content.md + metadata.json
5. 逐文件 POST /import ──────────→  写入 pgvector/PG FTS/S3
6. 显示进度和结果                     不兼容时入队 re-embed job
```

## 4. 认证

### 4.1 Login 命令

```bash
agent-fs login --target http://182.92.22.224:3000
> Email: user@example.com
> Password: ********
✓ 登录成功，token 已保存
```

调用 `POST /api/auth/login`，请求体增加 `"client": "cli"`。

### 4.2 JWT 本地存储

```
~/.agent_fs/credentials.json  (文件权限 600)
{
  "http://182.92.22.224:3000": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "expiresAt": "2026-04-10T10:00:00Z",
    "email": "user@example.com"
  }
}
```

- 支持多个 target 地址各自独立的凭证
- push 时自动读取；过期则提示重新 login

### 4.3 云端 JWT 改动

`POST /api/auth/login` 请求体新增可选字段 `client?: "cli"`。当 `client === "cli"` 时，accessToken 有效期设为 3 天。Web UI 不传此参数，保持 15 分钟不变。

## 5. 云端 API

### 5.1 Embedding Info

```
GET /api/projects/:projectId/embedding-info
Authorization: Bearer <jwt>
```

返回：

```json
{
  "model": "embedding-2",
  "dimension": 512
}
```

来源：云端 worker 的 embedding 配置（环境变量 `EMBEDDING_MODEL` / `EMBEDDING_DIMENSION`）。

### 5.2 Import

```
POST /api/projects/:projectId/import
Authorization: Bearer <jwt>
Content-Type: application/json
```

请求体：

```typescript
interface ImportFileRequest {
  fileName: string;           // 原始文件名
  dirRelativePath: string;    // 子目录相对路径，根目录文件传 "."
  summary?: string;           // 文档摘要
  sizeBytes: number;          // 原始文件大小

  // 归档内容
  archive: {
    "content.md": string;
    "metadata.json": string;
  };

  // 切片数据
  chunks: Array<{
    content: string;
    locator: string;
    lineStart: number;
    lineEnd: number;
    vector?: number[];        // embedding 兼容时携带；不兼容时为 null
  }>;
}
```

### 5.3 云端处理逻辑

```
收到请求
  ├─ 1. 查找或创建 directory (按 dirRelativePath + projectId)
  ├─ 2. 检查同名文件是否已存在 → 409 Conflict
  ├─ 3. 插入 files 记录 (status = 'importing')
  ├─ 4. 写入 archive (CloudArchiveAdapter)
  ├─ 5. 写入倒排索引 (CloudInvertedIndexAdapter)
  ├─ 6. chunks 有 vector？
  │     ├─ 是 → 写入 pgvector，status = 'indexed'
  │     └─ 否 → 入队 JOB_REEMBED_FILE，status = 'embedding'
  └─ 7. 返回 { fileId, status }
```

### 5.4 错误处理

- 同名文件重复导入：返回 409 Conflict
- 请求体过大：由 Fastify bodyLimit 控制（建议 50MB）
- 单文件写入失败：回滚该文件数据，不影响其他文件

## 6. Re-embed Job

### 6.1 Job 定义

`jobs/queue.ts` 新增：

```typescript
const JOB_REEMBED_FILE = 'reembed-file';

interface ReembedFileJob {
  tenantId: string;
  fileId: string;
  directoryId: string;
}
```

### 6.2 Worker 逻辑

复用现有 `indexing-worker` 的 `EmbeddingService`，跳过文档解析和切片：

1. 从 archive 读取 `content.md`，用 `MarkdownChunker` 重新切片获取 chunk 文本（切片参数与 import 时一致，保证 chunkId 对应关系）
2. 批量调用 embedding API 生成向量
3. 批量 UPDATE `chunks.content_vector`
4. 更新 `files.status = 'indexed'`

### 6.3 chunks 表改动

Import 写入时如果没有 vector，`content_vector` 列写入零向量占位，re-embed 完成后覆盖。

## 7. Files 表状态扩展

现有：`pending → indexing → indexed / failed`

新增 `importing` 和 `embedding` 状态：

```
pending → indexing → indexed         (正常上传)
importing → indexed                  (import + 向量兼容)
importing → embedding → indexed      (import + 向量不兼容)
any → failed                         (失败)
```

## 8. CLI Push 命令

### 8.1 命令格式

```bash
agent-fs push --target <url> --project <project-id> [path]
```

- `path` 默认当前目录，也可指定本地 project 路径
- 放在 `packages/mcp-server`，新增 `login` 和 `push` 子命令

### 8.2 执行流程

1. 读取 `~/.agent_fs/credentials.json` 获取 token；过期则提示 login
2. 验证本地路径是已索引 Project（`.fs_index/index.json` 存在）
3. `GET /api/projects/:id/embedding-info`，对比本地 `registry.json` 的 `embeddingModel`
4. 用 LocalAdapter 遍历所有目录和文件，按 fileId 分组读取数据
5. 逐文件 `POST /api/projects/:id/import`
6. 显示进度条和汇总结果

### 8.3 输出示例

```
Embedding 模型一致 (embedding-2)，将直接迁移向量
[  1/131] 审计准则第1101号.pdf ✓
[  2/131] 审计准则第1111号.pdf ✓
...
[131/131] 执业参考文档.xlsx ✓

推送完成：131 个文件
  成功：129
  跳过（已存在）：2
  失败：0
```

## 9. 改动范围

| 改动位置 | 内容 |
|---------|------|
| `packages/mcp-server` | 新增 `login` + `push` CLI 子命令 |
| `packages/server/src/routes` | 新增 `import-routes.ts`（import + embedding-info） |
| `packages/server/src/services` | 新增 `import-service.ts` |
| `packages/server/src/jobs` | 新增 `JOB_REEMBED_FILE` + worker 逻辑 |
| `packages/server/src/auth/jwt.ts` | 支持 `client: "cli"` 3 天有效期 |
| 数据库 | `files` 表新增 `importing` / `embedding` 状态值 |

不新建包，不改动 StorageAdapter 接口，不改动存储引擎。

## 10. 不在本次范围

- 云端到本地的反向同步
- 增量同步（仅推送变更文件）
- 子目录级别选择性推送
- 推送进度的断点续传

---

*Spec 版本: 1.0*
*创建日期: 2026-04-07*

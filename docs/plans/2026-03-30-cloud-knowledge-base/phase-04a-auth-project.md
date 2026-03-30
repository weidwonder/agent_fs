# Phase 4A: Auth + Tenant + Project CRUD + 服务层基础

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 创建 `packages/server` 基础骨架：Fastify 应用、JWT 认证、租户管理、项目 CRUD、统一服务层。此阶段不涉及索引和搜索。

**Prerequisite:** Phase 2 + Phase 3 complete (DB schema available)。

---

## 关键设计约束（来自审查报告）

1. **统一服务层**：不在 route 里直接 new adapter / 写 SQL。引入 `AuthService` / `ProjectService`
2. **单例依赖注入**：`CloudAdapter` / `EmbeddingService` 在 app 启动时创建一次，通过 Fastify decorator 注入
3. **租户隔离**：所有 Service 方法接收 `tenantId` 参数，SQL 必须带 tenant 过滤
4. **向量维度可配置**：读取 `tenants.config` 中的 embedding 配置决定维度
5. **storage-cloud 导出面**：确保 `getPool`、`initDb`、`closeDb`、`initS3`、`putObject`、`getObject`、`deleteObject`、`objectExists` 全部从 `@agent-fs/storage-cloud` 导出

---

## File Map

```
packages/server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # --mode=server | --mode=worker
│   ├── app.ts                      # Fastify app + DI 注册
│   ├── config.ts                   # 环境变量配置
│   ├── di.ts                       # 依赖注入：单例 adapter / services
│   ├── middleware/
│   │   ├── auth.ts                 # JWT verify + tenant 注入
│   │   └── error-handler.ts        # 全局错误处理
│   ├── services/
│   │   ├── auth-service.ts         # 注册/登录/刷新
│   │   └── project-service.ts      # 项目 CRUD
│   ├── routes/
│   │   ├── auth-routes.ts          # POST /auth/*
│   │   └── project-routes.ts       # CRUD /projects
│   └── __tests__/
│       └── auth.test.ts
```

---

### Task 1: Scaffold + Config + Entry Point

内容与原 Phase 4 Task 1-2 相同，但 `package.json` 增加 `@fastify/static`。

- [ ] **Step 1: Create package.json, tsconfig.json, config.ts, index.ts**

（参照原 Phase 4 Task 1-2，此处不重复完整代码）

- [ ] **Step 2: pnpm install + commit**

---

### Task 2: 更新 storage-cloud 导出面

**Files:**
- Modify: `packages/storage-cloud/src/index.ts`

- [ ] **Step 1: 确保以下 API 全部导出**

```typescript
// packages/storage-cloud/src/index.ts

// Adapter factory
export { createCloudAdapter } from './cloud-adapter-factory.js';
export type { CloudAdapterConfig } from './cloud-adapter-factory.js';

// Sub-adapters
export { CloudVectorStoreAdapter } from './cloud-vector-store-adapter.js';
export { CloudInvertedIndexAdapter } from './cloud-inverted-index-adapter.js';
export { CloudArchiveAdapter } from './cloud-archive-adapter.js';
export { CloudMetadataAdapter } from './cloud-metadata-adapter.js';

// DB pool (server 层需要直接查 users/tenants 表)
export { initDb, getPool, closeDb, type DbConfig } from './db.js';

// S3 helpers (server 层上传需要)
export { initS3, getS3, putObject, getObject, deleteObject, objectExists, type S3Config } from './s3.js';
```

- [ ] **Step 2: Build + commit**

---

### Task 3: 依赖注入模块

**Files:**
- Create: `packages/server/src/di.ts`

- [ ] **Step 1: Write DI module**

```typescript
// packages/server/src/di.ts

import type { StorageAdapter } from '@agent-fs/storage-adapter';
import { createCloudAdapter, initDb, initS3, type DbConfig, type S3Config } from '@agent-fs/storage-cloud';
import type { ServerConfig } from './config.js';

let storageAdapter: StorageAdapter | null = null;

export async function initDependencies(config: ServerConfig): Promise<void> {
  const dbConfig: DbConfig = { connectionString: config.databaseUrl };
  const s3Config: S3Config = {
    endpoint: config.s3Endpoint,
    bucket: config.s3Bucket,
    accessKeyId: config.s3AccessKey,
    secretAccessKey: config.s3SecretKey,
  };

  await initDb(dbConfig);
  initS3(s3Config);

  // 注意：adapter 在 per-request 级别创建（tenantId 不同）
  // 但 DB pool 和 S3 client 是全局单例
}

export function createTenantAdapter(tenantId: string): StorageAdapter {
  // 使用已初始化的全局 DB pool 和 S3 client
  // CloudAdapter 内部通过 getPool()/getS3() 获取
  return {
    vector: new (require('@agent-fs/storage-cloud').CloudVectorStoreAdapter)(tenantId),
    invertedIndex: new (require('@agent-fs/storage-cloud').CloudInvertedIndexAdapter)(tenantId),
    archive: new (require('@agent-fs/storage-cloud').CloudArchiveAdapter)(tenantId),
    metadata: new (require('@agent-fs/storage-cloud').CloudMetadataAdapter)(tenantId),
    async init() { await this.vector.init(); },
    async close() { /* pool is shared */ },
  };
}

export async function disposeDependencies(): Promise<void> {
  const { closeDb } = await import('@agent-fs/storage-cloud');
  await closeDb();
}
```

说明：`createTenantAdapter` 是轻量操作（只实例化对象），DB pool 和 S3 client 在 `initDependencies` 时已创建为全局单例。

- [ ] **Step 2: Commit**

---

### Task 4: Auth Service

**Files:**
- Create: `packages/server/src/services/auth-service.ts`
- Create: `packages/server/src/middleware/auth.ts`

- [ ] **Step 1: Write AuthService**

封装注册/登录/刷新逻辑，不依赖 Fastify request/reply：

```typescript
// packages/server/src/services/auth-service.ts

import { getPool } from '@agent-fs/storage-cloud';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../auth/jwt.js';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
  tenantId: string;
}

export class AuthService {
  constructor(
    private readonly jwtSecret: string,
    private readonly jwtExpiresIn: string,
    private readonly jwtRefreshExpiresIn: string,
  ) {}

  async register(email: string, password: string, tenantName: string): Promise<AuthResult> {
    const pool = getPool();
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) throw new Error('EMAIL_TAKEN');

    const passwordHash = await hashPassword(password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const userResult = await client.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id', [email, passwordHash]
      );
      const userId = userResult.rows[0].id;
      const tenantResult = await client.query(
        'INSERT INTO tenants (name, owner_id) VALUES ($1, $2) RETURNING id', [tenantName, userId]
      );
      const tenantId = tenantResult.rows[0].id;
      await client.query(
        'INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, $3)', [tenantId, userId, 'owner']
      );
      await client.query('COMMIT');

      return {
        accessToken: signAccessToken({ userId, tenantId, role: 'owner' }, this.jwtSecret, this.jwtExpiresIn),
        refreshToken: signRefreshToken(userId, this.jwtSecret, this.jwtRefreshExpiresIn),
        userId, tenantId,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const pool = getPool();
    const userResult = await pool.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) throw new Error('INVALID_CREDENTIALS');

    const user = userResult.rows[0];
    if (!(await verifyPassword(password, user.password_hash))) throw new Error('INVALID_CREDENTIALS');

    const memberResult = await pool.query(
      'SELECT tenant_id, role FROM tenant_members WHERE user_id = $1 LIMIT 1', [user.id]
    );
    if (memberResult.rows.length === 0) throw new Error('NO_TENANT');

    const { tenant_id: tenantId, role } = memberResult.rows[0];
    return {
      accessToken: signAccessToken({ userId: user.id, tenantId, role }, this.jwtSecret, this.jwtExpiresIn),
      refreshToken: signRefreshToken(user.id, this.jwtSecret, this.jwtRefreshExpiresIn),
      userId: user.id, tenantId,
    };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string }> {
    const payload = verifyToken(refreshToken, this.jwtSecret) as any;
    if (payload.type !== 'refresh') throw new Error('INVALID_TOKEN');

    const pool = getPool();
    const memberResult = await pool.query(
      'SELECT tenant_id, role FROM tenant_members WHERE user_id = $1 LIMIT 1', [payload.userId]
    );
    if (memberResult.rows.length === 0) throw new Error('NO_TENANT');

    const { tenant_id: tenantId, role } = memberResult.rows[0];
    return {
      accessToken: signAccessToken({ userId: payload.userId, tenantId, role }, this.jwtSecret, this.jwtExpiresIn),
    };
  }
}
```

- [ ] **Step 2: Write auth middleware** （同原 Phase 4 Task 3 Step 4）

- [ ] **Step 3: Write password.ts + jwt.ts** （同原 Phase 4 Task 3 Step 1-2）

- [ ] **Step 4: Commit**

---

### Task 5: Project Service + Routes

**Files:**
- Create: `packages/server/src/services/project-service.ts`
- Create: `packages/server/src/routes/auth-routes.ts`
- Create: `packages/server/src/routes/project-routes.ts`

- [ ] **Step 1: Write ProjectService**

```typescript
// packages/server/src/services/project-service.ts

import { getPool } from '@agent-fs/storage-cloud';

export class ProjectService {
  async list(tenantId: string) {
    const pool = getPool();
    const result = await pool.query(
      'SELECT id, name, config, created_at FROM projects WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId]
    );
    return result.rows;
  }

  async create(tenantId: string, name: string, config?: object) {
    const pool = getPool();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Create project
      const projResult = await client.query(
        'INSERT INTO projects (tenant_id, name, config) VALUES ($1, $2, $3) RETURNING id, name, created_at',
        [tenantId, name, config ?? {}]
      );
      const project = projResult.rows[0];
      // Create root directory
      await client.query(
        `INSERT INTO directories (project_id, relative_path) VALUES ($1, '.')`,
        [project.id]
      );
      await client.query('COMMIT');
      return project;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async delete(tenantId: string, projectId: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query(
      'DELETE FROM projects WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [projectId, tenantId]
    );
    return result.rowCount > 0;
  }

  async get(tenantId: string, projectId: string) {
    const pool = getPool();
    const result = await pool.query(
      'SELECT id, name, config, created_at FROM projects WHERE id = $1 AND tenant_id = $2',
      [projectId, tenantId]
    );
    return result.rows[0] ?? null;
  }
}
```

- [ ] **Step 2: Write auth-routes.ts and project-routes.ts**

Routes are thin wrappers calling services:

```typescript
// packages/server/src/routes/auth-routes.ts
app.post('/auth/register', async (request, reply) => {
  const { email, password, tenantName } = request.body as any;
  try {
    return await authService.register(email, password, tenantName || `${email}'s workspace`);
  } catch (err: any) {
    if (err.message === 'EMAIL_TAKEN') return reply.status(409).send({ error: 'Email already registered' });
    throw err;
  }
});
// ...login, refresh similar
```

```typescript
// packages/server/src/routes/project-routes.ts
app.get('/projects', { preHandler: auth }, async (request) => {
  return { projects: await projectService.list(request.user!.tenantId) };
});
// ...create, delete, get similar
```

- [ ] **Step 3: Write app.ts with DI + route registration**

```typescript
// packages/server/src/app.ts
export async function createApp(config: ServerConfig) {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  // Init global infrastructure
  await initDependencies(config);

  // Create services (singletons)
  const authService = new AuthService(config.jwtSecret, config.jwtExpiresIn, config.jwtRefreshExpiresIn);
  const projectService = new ProjectService();

  // Register routes
  await authRoutes(app, authService);
  await projectRoutes(app, projectService, config.jwtSecret);

  // Health check
  app.get('/health', async () => ({ status: 'ok' }));

  // Graceful shutdown
  app.addHook('onClose', async () => { await disposeDependencies(); });

  return app;
}
```

- [ ] **Step 4: Build + test + commit**

```bash
pnpm --filter @agent-fs/server build
pnpm --filter @agent-fs/server test
git add packages/server/
git commit -m "feat(server): add auth service, project service, routes with DI"
```

---

## Phase 4A Success Criteria

- [ ] `POST /auth/register` → 创建 user + tenant + membership，返回 JWT
- [ ] `POST /auth/login` → 验证密码，返回 JWT
- [ ] `POST /auth/refresh` → 刷新 access token
- [ ] `GET /projects` → 列出当前租户项目
- [ ] `POST /projects` → 创建项目（含 root directory）
- [ ] `DELETE /projects/:id` → 级联删除
- [ ] 全局单例 DB pool / S3 client，不在请求路径上重复初始化
- [ ] Services 层与 Routes 层分离，可被 MCP 工具复用
- [ ] `storage-cloud` 导出面完整，Phase 4B/4C 可直接使用

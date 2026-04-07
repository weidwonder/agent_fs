# Local-to-Cloud Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CLI command `agent-fs push` that pushes local indexed Project data to a cloud server, skipping document re-parsing.

**Architecture:** Local CLI reads data via LocalAdapter (LanceDB + SQLite + AFD), checks embedding compatibility with cloud, then POSTs each file's data to a new cloud Import API endpoint. Cloud writes to pgvector/PG FTS/S3 directly, or queues a re-embed job if embeddings don't match.

**Tech Stack:** TypeScript, Fastify, pg-boss, LocalAdapter, CloudAdapter, readline for interactive CLI

**Design Spec:** `docs/specs/2026-04-07-local-to-cloud-push-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `packages/server/src/routes/import-routes.ts` | `GET /embedding-info` + `POST /import` route handlers |
| `packages/server/src/services/import-service.ts` | Import file logic: create dir, write archive/vectors/inverted, enqueue re-embed |
| `packages/server/src/jobs/reembed-worker.ts` | Re-embed worker: read archive → chunk → embed → update vectors |
| `packages/mcp-server/src/cli/credentials.ts` | Read/write `~/.agent_fs/credentials.json` |
| `packages/mcp-server/src/cli/login.ts` | Interactive login command |
| `packages/mcp-server/src/cli/push.ts` | Push command: read local data, POST to cloud |

### Modified files

| File | Change |
|------|--------|
| `packages/server/src/services/auth-service.ts` | `login()` accepts optional `client` param, returns different expiry |
| `packages/server/src/routes/auth-routes.ts` | Extract `client` from login body, pass to service |
| `packages/server/src/jobs/queue.ts` | Add `JOB_REEMBED_FILE` + `ReembedFileJob` + `enqueueReembed()` |
| `packages/server/src/jobs/indexing-worker.ts` | Register reembed job handler |
| `packages/server/src/app.ts` | Register import routes, create `JOB_REEMBED_FILE` queue |
| `packages/mcp-server/src/index.ts` | Add CLI subcommand routing (login/push/serve) |
| `packages/mcp-server/package.json` | Add `readline` (built-in, no dep needed) |

---

## Task 1: JWT CLI Expiry Support

**Files:**
- Modify: `packages/server/src/services/auth-service.ts:70-99`
- Modify: `packages/server/src/routes/auth-routes.ts:42-53`
- Test: `packages/server/src/__tests__/auth-service.test.ts`

- [ ] **Step 1: Modify AuthService.login to accept client param**

```typescript
// packages/server/src/services/auth-service.ts
// Change the login method signature (line 70):

async login(email: string, password: string, client?: string): Promise<AuthResult> {
  // ... existing validation and user lookup unchanged ...

  const expiresIn = client === 'cli' ? '3d' : this.jwtExpiresIn;
  return {
    accessToken: signAccessToken({ userId: user.id, tenantId, role }, this.jwtSecret, expiresIn),
    refreshToken: signRefreshToken(user.id, this.jwtSecret, this.jwtRefreshExpiresIn),
    userId: user.id,
    tenantId,
  };
}
```

- [ ] **Step 2: Extract client from login route**

```typescript
// packages/server/src/routes/auth-routes.ts
// Change the login route handler (line 42-53):

app.post('/auth/login', async (request, reply) => {
  const { email, password, client } = request.body as {
    email: string;
    password: string;
    client?: string;
  };
  try {
    const result = await authService.login(email, password, client);
    return reply.send(result);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'INVALID_CREDENTIALS') {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }
    throw err;
  }
});
```

- [ ] **Step 3: Build and verify**

Run: `cd packages/server && pnpm build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/auth-service.ts packages/server/src/routes/auth-routes.ts
git commit -m "feat(server): support CLI client 3-day JWT expiry on login"
```

---

## Task 2: Re-embed Job Definition

**Files:**
- Modify: `packages/server/src/jobs/queue.ts`

- [ ] **Step 1: Add JOB_REEMBED_FILE and enqueueReembed**

```typescript
// packages/server/src/jobs/queue.ts — append after existing code:

export const JOB_REEMBED_FILE = 'reembed-file';

export interface ReembedFileJob {
  tenantId: string;
  fileId: string;
  directoryId: string;
}

export async function enqueueReembed(
  boss: PgBoss,
  job: ReembedFileJob,
): Promise<string | null> {
  const jobId = await boss.send(JOB_REEMBED_FILE, job, { singletonKey: job.fileId });
  if (!jobId) {
    throw new Error(`Failed to enqueue reembed job for file ${job.fileId}`);
  }
  return jobId;
}
```

- [ ] **Step 2: Build and verify**

Run: `cd packages/server && pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/jobs/queue.ts
git commit -m "feat(server): add JOB_REEMBED_FILE job definition"
```

---

## Task 3: Import Service

**Files:**
- Create: `packages/server/src/services/import-service.ts`

- [ ] **Step 1: Create ImportService**

```typescript
// packages/server/src/services/import-service.ts

import PgBoss from 'pg-boss';
import { getPool, createCloudAdapter } from '@agent-fs/storage-cloud';
import type { VectorDocument } from '@agent-fs/core';
import type { InvertedIndexEntry } from '@agent-fs/storage-adapter';
import { enqueueReembed } from '../jobs/queue.js';

export interface ImportChunk {
  content: string;
  locator: string;
  lineStart: number;
  lineEnd: number;
  vector?: number[] | null;
}

export interface ImportFileRequest {
  fileName: string;
  dirRelativePath: string;
  summary?: string;
  sizeBytes: number;
  archive: Record<string, string>;
  chunks: ImportChunk[];
}

export interface ImportFileResult {
  fileId: string;
  status: 'indexed' | 'embedding';
}

export class ImportService {
  constructor(private readonly boss: PgBoss) {}

  async importFile(
    tenantId: string,
    projectId: string,
    req: ImportFileRequest,
  ): Promise<ImportFileResult> {
    const pool = getPool();

    // 1. Find or create directory
    const dirId = await this.findOrCreateDirectory(
      tenantId,
      projectId,
      req.dirRelativePath,
    );

    // 2. Check duplicate
    const dupCheck = await pool.query(
      `SELECT id FROM files
       WHERE directory_id = $1 AND tenant_id = $2 AND name = $3`,
      [dirId, tenantId, req.fileName],
    );
    if (dupCheck.rows.length > 0) {
      throw new Error('FILE_EXISTS');
    }

    // 3. Insert file record
    const fileResult = await pool.query(
      `INSERT INTO files (directory_id, tenant_id, name, size_bytes, status)
       VALUES ($1, $2, $3, $4, 'importing') RETURNING id`,
      [dirId, tenantId, req.fileName, req.sizeBytes],
    );
    const fileId = fileResult.rows[0].id as string;

    const hasVectors = req.chunks.length > 0 && req.chunks[0].vector != null;

    try {
      // 4. Write to cloud storage
      const adapter = createCloudAdapter({ tenantId });
      await adapter.init();
      try {
        // 4a. Write archive
        await adapter.archive.write(fileId, { files: req.archive });

        // 4b. Write inverted index
        const invertedEntries: InvertedIndexEntry[] = req.chunks.map(
          (chunk, i) => ({
            text: chunk.content,
            chunkId: `${fileId}:${i}`,
            locator: chunk.locator,
          }),
        );
        await adapter.invertedIndex.addFile(fileId, dirId, invertedEntries);

        // 4c. Write vectors (or zero-vector placeholder)
        const dimension = hasVectors
          ? req.chunks[0].vector!.length
          : Number(process.env['EMBEDDING_DIMENSION'] ?? '512');

        const vectorDocs: VectorDocument[] = req.chunks.map((chunk, i) => ({
          chunk_id: `${fileId}:${i}`,
          file_id: fileId,
          dir_id: dirId,
          rel_path: req.fileName,
          file_path: req.fileName,
          chunk_line_start: chunk.lineStart,
          chunk_line_end: chunk.lineEnd,
          content_vector: hasVectors
            ? chunk.vector!
            : new Array(dimension).fill(0),
          locator: chunk.locator,
          indexed_at: new Date().toISOString(),
          deleted_at: '',
        }));
        await adapter.vector.addDocuments(vectorDocs);
      } finally {
        await adapter.close();
      }

      // 5. Update file status
      const finalStatus = hasVectors ? 'indexed' : 'embedding';
      await pool.query(
        `UPDATE files
         SET status = $2, chunk_count = $3, summary = $4,
             afd_key = $5, indexed_at = now(), updated_at = now()
         WHERE id = $1`,
        [
          fileId,
          finalStatus,
          req.chunks.length,
          req.summary ?? '',
          `${tenantId}/${fileId}`,
        ],
      );

      // 6. Enqueue re-embed if needed
      if (!hasVectors) {
        await enqueueReembed(this.boss, {
          tenantId,
          fileId,
          directoryId: dirId,
        });
      }

      return { fileId, status: finalStatus };
    } catch (err) {
      // Cleanup on failure
      await pool.query(
        "UPDATE files SET status = 'failed', error_message = $2, updated_at = now() WHERE id = $1",
        [fileId, err instanceof Error ? err.message.slice(0, 500) : 'Unknown error'],
      );
      throw err;
    }
  }

  private async findOrCreateDirectory(
    tenantId: string,
    projectId: string,
    relativePath: string,
  ): Promise<string> {
    const pool = getPool();

    // Try to find existing directory
    const existing = await pool.query(
      `SELECT id FROM directories
       WHERE project_id = $1 AND tenant_id = $2 AND relative_path = $3`,
      [projectId, tenantId, relativePath],
    );
    if (existing.rows.length > 0) {
      return existing.rows[0].id as string;
    }

    // Create new directory
    const result = await pool.query(
      `INSERT INTO directories (project_id, tenant_id, relative_path)
       VALUES ($1, $2, $3) RETURNING id`,
      [projectId, tenantId, relativePath],
    );
    return result.rows[0].id as string;
  }
}
```

- [ ] **Step 2: Build and verify**

Run: `cd packages/server && pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/services/import-service.ts
git commit -m "feat(server): add ImportService for local-to-cloud data import"
```

---

## Task 4: Import Routes

**Files:**
- Create: `packages/server/src/routes/import-routes.ts`
- Modify: `packages/server/src/app.ts:28-29,46-68`

- [ ] **Step 1: Create import routes**

```typescript
// packages/server/src/routes/import-routes.ts

import type { FastifyInstance } from 'fastify';
import { createAuthMiddleware } from '../middleware/auth.js';
import type { ImportService, ImportFileRequest } from '../services/import-service.js';
import { buildEmbeddingConfig } from '../services/embedding-config.js';

export async function importRoutes(
  app: FastifyInstance,
  importService: ImportService,
  jwtSecret: string,
): Promise<void> {
  const auth = createAuthMiddleware(jwtSecret);

  // GET /projects/:projectId/embedding-info
  app.get(
    '/projects/:projectId/embedding-info',
    { preHandler: auth },
    async (request, reply) => {
      const config = buildEmbeddingConfig();
      const model =
        config.default === 'api'
          ? config.api!.model
          : config.local!.model;
      const dimension = Number(process.env['EMBEDDING_DIMENSION'] ?? '512');
      return reply.send({ model, dimension });
    },
  );

  // POST /projects/:projectId/import
  app.post(
    '/projects/:projectId/import',
    { preHandler: auth },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const tenantId = request.user!.tenantId;
      const body = request.body as ImportFileRequest;

      try {
        const result = await importService.importFile(tenantId, projectId, body);
        return reply.status(201).send(result);
      } catch (err: unknown) {
        if (err instanceof Error && err.message === 'FILE_EXISTS') {
          return reply.status(409).send({ error: 'File already exists in this directory' });
        }
        throw err;
      }
    },
  );
}
```

- [ ] **Step 2: Register import routes in app.ts**

Add import at top of `packages/server/src/app.ts`:

```typescript
import { ImportService } from './services/import-service.js';
import { importRoutes } from './routes/import-routes.js';
import { JOB_REEMBED_FILE } from './jobs/queue.js';
```

Note: `JOB_INDEX_FILE` is already imported. Change the import line to:

```typescript
import { JOB_INDEX_FILE, JOB_REEMBED_FILE } from './jobs/queue.js';
```

After `boss.createQueue(JOB_INDEX_FILE)` (line 47), add:

```typescript
await boss.createQueue(JOB_REEMBED_FILE);
```

After `const indexingService = ...` (line 55), add:

```typescript
const importService = new ImportService(boss);
```

Inside the `/api` prefix register block (line 60-68), add after `searchRoutes`:

```typescript
await importRoutes(api, importService, config.jwtSecret);
```

Also increase body limit for import payloads. Change line 31:

```typescript
const app = Fastify({ logger: true, bodyLimit: 52428800 }); // 50MB
```

- [ ] **Step 3: Build and verify**

Run: `cd packages/server && pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/import-routes.ts packages/server/src/app.ts
git commit -m "feat(server): add import routes and embedding-info endpoint"
```

---

## Task 5: Re-embed Worker

**Files:**
- Create: `packages/server/src/jobs/reembed-worker.ts`
- Modify: `packages/server/src/jobs/indexing-worker.ts`

- [ ] **Step 1: Create reembed worker logic**

```typescript
// packages/server/src/jobs/reembed-worker.ts

import { getPool, createCloudAdapter } from '@agent-fs/storage-cloud';
import { MarkdownChunker } from '@agent-fs/core';
import type { EmbeddingService } from '@agent-fs/llm';
import type { ReembedFileJob } from './queue.js';

export async function processReembedJob(
  data: ReembedFileJob,
  embeddingService: EmbeddingService,
): Promise<void> {
  const { tenantId, fileId, directoryId } = data;
  const pool = getPool();

  try {
    await pool.query(
      "UPDATE files SET status = 'embedding', updated_at = now() WHERE id = $1",
      [fileId],
    );

    // 1. Read archive to get content.md
    const adapter = createCloudAdapter({ tenantId });
    await adapter.init();
    let contentMd: string;
    try {
      contentMd = await adapter.archive.read(fileId, 'content.md');
    } finally {
      await adapter.close();
    }

    // 2. Re-chunk to get texts (same params as indexing-worker)
    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 400 });
    const chunkMetas = chunker.chunk(contentMd);

    // 3. Embed
    const embedResult = await embeddingService.embedBatch(
      chunkMetas.map((c) => c.content),
    );

    // 4. Update vectors in chunks table
    for (let i = 0; i < chunkMetas.length; i++) {
      const chunkId = `${fileId}:${i}`;
      const vector = embedResult.embeddings[i];
      const vectorStr = `[${vector.join(',')}]`;
      await pool.query(
        `UPDATE chunks SET content_vector = $2::vector WHERE id = $1`,
        [chunkId, vectorStr],
      );
    }

    // 5. Mark file as indexed
    await pool.query(
      "UPDATE files SET status = 'indexed', updated_at = now() WHERE id = $1",
      [fileId],
    );

    console.log(`Re-embedded: file ${fileId} (${chunkMetas.length} chunks)`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to re-embed file ${fileId}:`, error);

    await pool.query(
      "UPDATE files SET status = 'failed', error_message = $2, updated_at = now() WHERE id = $1",
      [fileId, message.slice(0, 500)],
    );
  }
}
```

- [ ] **Step 2: Register reembed handler in indexing-worker.ts**

In `packages/server/src/jobs/indexing-worker.ts`, add import at top:

```typescript
import { JOB_REEMBED_FILE, type ReembedFileJob } from './queue.js';
import { processReembedJob } from './reembed-worker.js';
```

In the `startWorker` function, after the existing `boss.work<IndexFileJob>(...)` block (after line 63), add:

```typescript
await boss.createQueue(JOB_REEMBED_FILE);
await boss.work<ReembedFileJob>(
  JOB_REEMBED_FILE,
  { batchSize: 2, pollingIntervalSeconds: 2 },
  async (jobs) => {
    for (const job of jobs) {
      await processReembedJob(job.data, embeddingService);
    }
  },
);
```

- [ ] **Step 3: Build and verify**

Run: `cd packages/server && pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/jobs/reembed-worker.ts packages/server/src/jobs/indexing-worker.ts
git commit -m "feat(server): add re-embed worker for imported files without vectors"
```

---

## Task 6: Credentials Manager

**Files:**
- Create: `packages/mcp-server/src/cli/credentials.ts`

- [ ] **Step 1: Create credentials module**

```typescript
// packages/mcp-server/src/cli/credentials.ts

import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface TargetCredential {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  email: string;
}

type CredentialsStore = Record<string, TargetCredential>;

function credentialsPath(): string {
  return join(homedir(), '.agent_fs', 'credentials.json');
}

export function readCredentials(): CredentialsStore {
  const path = credentialsPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as CredentialsStore;
  } catch {
    return {};
  }
}

export function saveCredential(
  target: string,
  credential: TargetCredential,
): void {
  const dir = join(homedir(), '.agent_fs');
  mkdirSync(dir, { recursive: true });

  const store = readCredentials();
  store[target] = credential;

  const path = credentialsPath();
  writeFileSync(path, JSON.stringify(store, null, 2));
  chmodSync(path, 0o600);
}

export function getCredential(target: string): TargetCredential | null {
  const store = readCredentials();
  const cred = store[target];
  if (!cred) return null;

  // Check expiry
  if (new Date(cred.expiresAt) <= new Date()) return null;

  return cred;
}
```

- [ ] **Step 2: Build and verify**

Run: `cd packages/mcp-server && pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/mcp-server/src/cli/credentials.ts
git commit -m "feat(mcp-server): add credentials manager for CLI auth"
```

---

## Task 7: Login CLI Command

**Files:**
- Create: `packages/mcp-server/src/cli/login.ts`

- [ ] **Step 1: Create login command**

```typescript
// packages/mcp-server/src/cli/login.ts

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { saveCredential } from './credentials.js';

export async function loginCommand(target: string): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const email = await rl.question('Email: ');
    // Read password without echo
    const password = await readPassword(rl, 'Password: ');

    console.log('正在登录...');

    const response = await fetch(`${target}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, client: 'cli' }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      console.error(`登录失败: ${(err as { error: string }).error}`);
      process.exit(1);
    }

    const data = (await response.json()) as {
      accessToken: string;
      refreshToken: string;
    };

    // Calculate expiry (3 days from now)
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    saveCredential(target, {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt,
      email,
    });

    console.log('✓ 登录成功，token 已保存');
  } finally {
    rl.close();
  }
}

async function readPassword(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
): Promise<string> {
  // Simple password read — no echo suppression in basic readline,
  // but functional for CLI usage
  const password = await rl.question(prompt);
  return password;
}
```

- [ ] **Step 2: Build and verify**

Run: `cd packages/mcp-server && pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/mcp-server/src/cli/login.ts
git commit -m "feat(mcp-server): add interactive login CLI command"
```

---

## Task 8: Push CLI Command

**Files:**
- Create: `packages/mcp-server/src/cli/push.ts`

- [ ] **Step 1: Create push command**

```typescript
// packages/mcp-server/src/cli/push.ts

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { getCredential } from './credentials.js';

interface RegistryProject {
  path: string;
  alias: string;
  projectId: string;
  totalFileCount: number;
  embeddingModel?: string;
  subdirectories: Array<{
    relativePath: string;
    dirId: string;
    fileCount: number;
  }>;
}

interface Registry {
  embeddingModel: string;
  embeddingDimension: number;
  projects: RegistryProject[];
}

interface IndexFileEntry {
  fileId: string;
  fileName: string;
  chunkCount: number;
  summary?: string;
  sizeBytes?: number;
}

interface IndexMetadataJson {
  dirId: string;
  relativePath: string;
  files: IndexFileEntry[];
}

export async function pushCommand(
  target: string,
  projectId: string,
  localPath?: string,
): Promise<void> {
  // 1. Resolve local path
  const projectPath = resolve(localPath ?? process.cwd());
  const fsIndexDir = join(projectPath, '.fs_index');
  const indexJsonPath = join(fsIndexDir, 'index.json');

  if (!existsSync(indexJsonPath)) {
    console.error(`错误: ${projectPath} 不是已索引的 Project（未找到 .fs_index/index.json）`);
    process.exit(1);
  }

  // 2. Get credentials
  const cred = getCredential(target);
  if (!cred) {
    console.error(`错误: 未登录到 ${target}，请先运行: agent-fs login --target ${target}`);
    process.exit(1);
  }

  // 3. Check embedding compatibility
  const embeddingInfo = await fetchJson<{ model: string; dimension: number }>(
    `${target}/api/projects/${projectId}/embedding-info`,
    cred.accessToken,
  );

  const registry = readRegistry();
  const localProject = registry?.projects.find((p) => p.path === projectPath);
  const localModel = registry?.embeddingModel ?? 'unknown';
  const embeddingMatch = localModel === embeddingInfo.model;

  if (embeddingMatch) {
    console.log(`Embedding 模型一致 (${localModel})，将直接迁移向量`);
  } else {
    console.log(
      `Embedding 模型不一致（本地: ${localModel}, 云端: ${embeddingInfo.model}），云端将重新生成向量`,
    );
  }

  // 4. Collect all files from all directories
  const allFiles = collectFiles(projectPath);
  const total = allFiles.length;
  let success = 0;
  let skipped = 0;
  let failed = 0;

  // 5. Push each file
  for (let i = 0; i < allFiles.length; i++) {
    const file = allFiles[i];
    const label = `[${String(i + 1).padStart(String(total).length)}/${total}]`;

    try {
      const body = await buildImportBody(file, fsIndexDir, embeddingMatch);

      const response = await fetch(`${target}/api/projects/${projectId}/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cred.accessToken}`,
        },
        body: JSON.stringify(body),
      });

      if (response.status === 409) {
        console.log(`${label} ${file.fileName} ⊘ 已存在，跳过`);
        skipped++;
      } else if (!response.ok) {
        const err = await response.text();
        console.error(`${label} ${file.fileName} ✗ ${err}`);
        failed++;
      } else {
        console.log(`${label} ${file.fileName} ✓`);
        success++;
      }
    } catch (err) {
      console.error(`${label} ${file.fileName} ✗ ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  // 6. Summary
  console.log(`\n推送完成：${total} 个文件`);
  console.log(`  成功：${success}`);
  if (skipped > 0) console.log(`  跳过（已存在）：${skipped}`);
  if (failed > 0) console.log(`  失败：${failed}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CollectedFile {
  fileName: string;
  fileId: string;
  dirRelativePath: string;
  summary?: string;
  sizeBytes: number;
  chunkCount: number;
}

function collectFiles(projectPath: string): CollectedFile[] {
  const files: CollectedFile[] = [];
  collectFilesRecursive(projectPath, '.', files);
  return files;
}

function collectFilesRecursive(
  projectPath: string,
  relativePath: string,
  files: CollectedFile[],
): void {
  const dirPath = relativePath === '.' ? projectPath : join(projectPath, relativePath);
  const indexJsonPath = join(dirPath, '.fs_index', 'index.json');

  if (!existsSync(indexJsonPath)) return;

  const metadata = JSON.parse(readFileSync(indexJsonPath, 'utf-8')) as IndexMetadataJson;

  for (const file of metadata.files) {
    files.push({
      fileName: file.fileName,
      fileId: file.fileId,
      dirRelativePath: relativePath,
      summary: file.summary,
      sizeBytes: file.sizeBytes ?? 0,
      chunkCount: file.chunkCount,
    });
  }

  // Recurse into subdirectories
  const { readdirSync, statSync } = await import('node:fs');
  // Note: We can't use dynamic import in sync context. Use existsSync-based approach instead.
  // Check subdirectories by scanning for .fs_index dirs
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== '.fs_index') {
        const subRelPath =
          relativePath === '.' ? entry.name : `${relativePath}/${entry.name}`;
        const subIndexPath = join(dirPath, entry.name, '.fs_index', 'index.json');
        if (existsSync(subIndexPath)) {
          collectFilesRecursive(projectPath, subRelPath, files);
        }
      }
    }
  } catch {
    // Ignore read errors
  }
}

async function buildImportBody(
  file: CollectedFile,
  fsIndexDir: string,
  embeddingMatch: boolean,
): Promise<Record<string, unknown>> {
  // Read archive data from AFD
  const { createAFDStorage } = await import('@agent-fs/storage');

  const dirFsIndex =
    file.dirRelativePath === '.'
      ? fsIndexDir
      : join(fsIndexDir, '..', file.dirRelativePath, '.fs_index');
  const documentsDir = join(dirFsIndex, 'documents');

  const storage = createAFDStorage({ documentsDir });
  const contentMd = await storage.readText(file.fileId, 'content.md');

  let metadataJson = '{}';
  try {
    metadataJson = await storage.readText(file.fileId, 'metadata.json');
  } catch {
    // metadata.json may not exist for some files
  }

  // Read chunks from LanceDB for vectors
  let chunks: Array<Record<string, unknown>> = [];

  // Re-chunk the content.md to get chunk data
  const { MarkdownChunker } = await import('@agent-fs/core');
  const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 400 });
  const chunkMetas = chunker.chunk(contentMd);

  // If embedding matches, try to read vectors from LanceDB
  if (embeddingMatch) {
    try {
      const { createLocalAdapter } = await import('@agent-fs/storage-adapter');
      const adapter = createLocalAdapter({
        indexDir: dirFsIndex.endsWith('.fs_index') ? dirFsIndex : join(dirFsIndex, '..', '.fs_index'),
      });
      await adapter.init();
      try {
        const chunkIds = chunkMetas.map((_, i) => `${file.fileId}:${i}`);
        const vectorDocs = await adapter.vector.getByChunkIds(chunkIds);
        const vectorMap = new Map(vectorDocs.map((d) => [d.chunk_id, d.content_vector]));

        chunks = chunkMetas.map((meta, i) => ({
          content: meta.content,
          locator: meta.locator,
          lineStart: meta.lineStart,
          lineEnd: meta.lineEnd,
          vector: vectorMap.get(`${file.fileId}:${i}`) ?? null,
        }));
      } finally {
        await adapter.close();
      }
    } catch {
      // Fallback to no vectors
      chunks = chunkMetas.map((meta) => ({
        content: meta.content,
        locator: meta.locator,
        lineStart: meta.lineStart,
        lineEnd: meta.lineEnd,
        vector: null,
      }));
    }
  } else {
    chunks = chunkMetas.map((meta) => ({
      content: meta.content,
      locator: meta.locator,
      lineStart: meta.lineStart,
      lineEnd: meta.lineEnd,
      vector: null,
    }));
  }

  return {
    fileName: file.fileName,
    dirRelativePath: file.dirRelativePath,
    summary: file.summary,
    sizeBytes: file.sizeBytes,
    archive: {
      'content.md': contentMd,
      'metadata.json': metadataJson,
    },
    chunks,
  };
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

function readRegistry(): Registry | null {
  const registryPath = join(homedir(), '.agent_fs', 'registry.json');
  if (!existsSync(registryPath)) return null;
  try {
    return JSON.parse(readFileSync(registryPath, 'utf-8')) as Registry;
  } catch {
    return null;
  }
}
```

**Note:** `collectFilesRecursive` has a bug — it uses `readdirSync` via dynamic import which won't work in a sync function. Fix:

Replace the `readdirSync` section with a static import at the top of the file. `readdirSync` is already available from the top import `import { existsSync, readFileSync } from 'node:fs'` — just add it to the import:

```typescript
import { existsSync, readFileSync, readdirSync } from 'node:fs';
```

And remove the `const { readdirSync, statSync } = await import('node:fs');` line.

- [ ] **Step 2: Build and verify**

Run: `cd packages/mcp-server && pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/mcp-server/src/cli/push.ts
git commit -m "feat(mcp-server): add push CLI command for local-to-cloud migration"
```

---

## Task 9: CLI Entry Point

**Files:**
- Modify: `packages/mcp-server/src/index.ts`

- [ ] **Step 1: Add CLI subcommand routing**

Replace `packages/mcp-server/src/index.ts` contents with:

```typescript
#!/usr/bin/env node
import { startHttpServer } from './http-server.js';
import { parseListenOptions } from './listen-config.js';

const subcommand = process.argv[2];

async function main() {
  if (subcommand === 'login') {
    const target = getArg('--target');
    if (!target) {
      console.error('Usage: agent-fs login --target <url>');
      process.exit(1);
    }
    const { loginCommand } = await import('./cli/login.js');
    await loginCommand(target);
    return;
  }

  if (subcommand === 'push') {
    const target = getArg('--target');
    const project = getArg('--project');
    if (!target || !project) {
      console.error('Usage: agent-fs push --target <url> --project <project-id> [path]');
      process.exit(1);
    }
    // path is the first positional arg after flags
    const path = getPositionalArg();
    const { pushCommand } = await import('./cli/push.js');
    await pushCommand(target, project, path);
    return;
  }

  // Default: start MCP server
  const options = parseListenOptions(
    subcommand === 'serve' ? process.argv.slice(3) : process.argv.slice(2),
  );
  const server = await startHttpServer(options);

  let shuttingDown = false;
  const shutdown = async (exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await server.close();
    } finally {
      process.exit(exitCode);
    }
  };

  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));

  console.error(`Agent FS MCP Server listening on ${server.mcpUrl}`);
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function getPositionalArg(): string | undefined {
  // Find args that are not flags and not the subcommand
  const args = process.argv.slice(3);
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      i++; // skip flag value
      continue;
    }
    return args[i];
  }
  return undefined;
}

main().catch((error) => {
  console.error('Failed:', error);
  process.exit(1);
});
```

- [ ] **Step 2: Build and verify**

Run: `cd packages/mcp-server && pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Verify help message**

Run: `node packages/mcp-server/dist/index.js login`
Expected: Shows "Usage: agent-fs login --target <url>"

Run: `node packages/mcp-server/dist/index.js push`
Expected: Shows "Usage: agent-fs push --target <url> --project <project-id> [path]"

- [ ] **Step 4: Commit**

```bash
git add packages/mcp-server/src/index.ts
git commit -m "feat(mcp-server): add CLI subcommand routing for login/push/serve"
```

---

## Task 10: Integration Test

- [ ] **Step 1: Build all packages**

Run: `pnpm -r build`
Expected: All packages build successfully

- [ ] **Step 2: Manual test — login (against cloud)**

```bash
node packages/mcp-server/dist/index.js login --target http://182.92.22.224:3000
```

Expected: Interactive email/password prompt, then "✓ 登录成功，token 已保存"

Verify: `cat ~/.agent_fs/credentials.json` shows the saved credential

- [ ] **Step 3: Manual test — push (against cloud)**

First, create a target project on cloud (via Web UI or curl).

```bash
node packages/mcp-server/dist/index.js push \
  --target http://182.92.22.224:3000 \
  --project <cloud-project-id> \
  "/Users/weidwonder/tasks/260205 审计知识库建立"
```

Expected: Shows embedding comparison, then file-by-file progress, then summary.

- [ ] **Step 4: Verify cloud data**

Login to cloud and search for imported content to confirm data was written correctly.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: local-to-cloud push — complete implementation"
```

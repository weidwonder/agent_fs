# Phase 4B: Upload + Worker + IndexPipeline 接入 + SSE

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 闭合"上传 → 入队 → 真实索引 → 状态更新 → SSE 通知"的完整链路。Worker 真正调用 IndexPipeline + CloudAdapter 完成文档处理。

**Prerequisite:** Phase 4A complete.

---

## 关键设计约束

1. **Worker 必须调用真实 IndexPipeline**：不再 stub，从 S3 下载 → 插件转换 → chunk → embed → summary → CloudAdapter 写入
2. **pg-boss 任务有幂等性**：相同 fileId 重复入队不会产生重复索引
3. **文件状态机**：`pending → indexing → indexed | failed`，失败记录 `error_message`
4. **SSE 进度推送**：`GET /projects/:id/indexing-events`

---

## File Map (新增)

```
packages/server/src/
├── services/
│   ├── indexing-service.ts         # 上传 + 入队 + 状态查询
│   └── file-service.ts             # 文件 CRUD
├── routes/
│   ├── document-routes.ts          # POST upload, GET files, DELETE file
│   └── indexing-event-routes.ts    # GET SSE
├── jobs/
│   ├── queue.ts                    # pg-boss init
│   └── indexing-worker.ts          # 真实 worker：调用 IndexPipeline
```

---

### Task 1: pg-boss Queue + Job 定义

（同原 Phase 4 Task 5 Step 1 queue.ts，增加 `error_message` 字段和幂等 key）

- [ ] **Step 1: Write queue.ts**

```typescript
export interface IndexFileJob {
  tenantId: string;
  projectId: string;
  directoryId: string;
  fileId: string;
  fileName: string;
  s3TempKey: string;
}

// 使用 fileId 作为 singletonKey 防止重复
export async function enqueueIndexing(job: IndexFileJob): Promise<string | null> {
  return getQueue().send(JOB_INDEX_FILE, job, { singletonKey: job.fileId });
}
```

- [ ] **Step 2: Commit**

---

### Task 2: IndexingService + DocumentRoutes

- [ ] **Step 1: Write IndexingService**

```typescript
// packages/server/src/services/indexing-service.ts

import { getPool, putObject } from '@agent-fs/storage-cloud';
import { enqueueIndexing } from '../jobs/queue.js';

export class IndexingService {
  async uploadAndEnqueue(
    tenantId: string, projectId: string, fileName: string, fileBuffer: Buffer
  ): Promise<{ fileId: string }> {
    const pool = getPool();

    // Get or create root directory
    let dirResult = await pool.query(
      `SELECT id FROM directories WHERE project_id = $1 AND relative_path = '.'`, [projectId]
    );
    const directoryId = dirResult.rows[0].id;

    // Create file record with status 'pending'
    const fileResult = await pool.query(
      `INSERT INTO files (directory_id, tenant_id, name, size_bytes, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
      [directoryId, tenantId, fileName, fileBuffer.length]
    );
    const fileId = fileResult.rows[0].id;

    // Upload to S3 temp
    const s3TempKey = `${tenantId}/tmp/${fileId}/${fileName}`;
    await putObject(s3TempKey, fileBuffer);

    // Enqueue
    await enqueueIndexing({ tenantId, projectId, directoryId, fileId, fileName, s3TempKey });

    return { fileId };
  }

  async listFiles(tenantId: string, projectId: string) {
    const pool = getPool();
    const result = await pool.query(
      `SELECT f.id, f.name, f.size_bytes, f.chunk_count, f.status, f.error_message, f.indexed_at, f.created_at
       FROM files f JOIN directories d ON f.directory_id = d.id
       WHERE d.project_id = $1 AND f.tenant_id = $2 ORDER BY f.created_at DESC`,
      [projectId, tenantId]
    );
    return result.rows;
  }

  async deleteFile(tenantId: string, fileId: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query('DELETE FROM files WHERE id = $1 AND tenant_id = $2 RETURNING id', [fileId, tenantId]);
    return result.rowCount > 0;
  }
}
```

- [ ] **Step 2: Write document-routes.ts** (thin wrappers calling IndexingService)

- [ ] **Step 3: Commit**

---

### Task 3: Real Indexing Worker

**Files:**
- Create: `packages/server/src/jobs/indexing-worker.ts`

- [ ] **Step 1: Write worker that calls IndexPipeline**

```typescript
// packages/server/src/jobs/indexing-worker.ts

import PgBoss from 'pg-boss';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb, initS3, getPool, getObject, deleteObject } from '@agent-fs/storage-cloud';
import { CloudVectorStoreAdapter, CloudInvertedIndexAdapter, CloudArchiveAdapter } from '@agent-fs/storage-cloud';
import { IndexPipeline } from '@agent-fs/indexer';
import { EmbeddingService, SummaryService } from '@agent-fs/llm';
import { PluginManager } from '@agent-fs/indexer';
import { JOB_INDEX_FILE, type IndexFileJob } from './queue.js';
import type { ServerConfig } from '../config.js';

export async function startWorker(config: ServerConfig) {
  await initDb({ connectionString: config.databaseUrl });
  initS3({
    endpoint: config.s3Endpoint,
    bucket: config.s3Bucket,
    accessKeyId: config.s3AccessKey,
    secretAccessKey: config.s3SecretKey,
  });

  // 全局初始化 embedding service（重资源，只创建一次）
  const embeddingService = new EmbeddingService();
  await embeddingService.init();

  const summaryService = new SummaryService();
  const pluginManager = new PluginManager();

  const boss = new PgBoss(config.databaseUrl);
  await boss.start();

  await boss.work<IndexFileJob>(JOB_INDEX_FILE, { teamSize: 2 }, async (job) => {
    const { tenantId, directoryId, fileId, fileName, s3TempKey } = job.data;
    const pool = getPool();

    try {
      await pool.query("UPDATE files SET status = 'indexing' WHERE id = $1", [fileId]);

      // 1. Download from S3 to temp dir
      const tempDir = join(tmpdir(), `agentfs-index-${fileId}`);
      mkdirSync(tempDir, { recursive: true });
      const tempFilePath = join(tempDir, fileName);
      const fileBuffer = await getObject(s3TempKey);
      writeFileSync(tempFilePath, fileBuffer);

      // 2. Create tenant-scoped adapters
      const vectorAdapter = new CloudVectorStoreAdapter(tenantId);
      await vectorAdapter.init();
      const invertedAdapter = new CloudInvertedIndexAdapter(tenantId);
      const archiveAdapter = new CloudArchiveAdapter(tenantId);

      // 3. Build StorageAdapter for IndexPipeline
      const storage = {
        vector: vectorAdapter,
        invertedIndex: invertedAdapter,
        archive: archiveAdapter,
        metadata: null as any, // Pipeline writes metadata to DB via files table
        async init() {},
        async close() {},
      };

      // 4. Run IndexPipeline for this single file
      //    Note: IndexPipeline 需要适配为接收单文件模式
      //    或者我们直接走文件级处理步骤
      const plugin = pluginManager.getPlugin(fileName);
      if (!plugin) {
        throw new Error(`No plugin for file: ${fileName}`);
      }

      // Convert
      const convResult = await plugin.toMarkdown(tempFilePath);

      // Chunk
      const { MarkdownChunker } = await import('@agent-fs/core');
      const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });
      const chunks = chunker.chunk(convResult.markdown, {
        fileId, dirId: directoryId, relPath: fileName, filePath: tempFilePath,
      });

      // Embed
      const embedResult = await embeddingService.embedBatch(chunks.map(c => c.content));

      // Build VectorDocuments
      const vectorDocs = chunks.map((chunk, i) => ({
        chunk_id: chunk.id,
        file_id: fileId,
        dir_id: directoryId,
        rel_path: fileName,
        file_path: fileName,
        chunk_line_start: chunk.lineStart,
        chunk_line_end: chunk.lineEnd,
        content_vector: embedResult.embeddings[i],
        locator: chunk.locator || '',
        indexed_at: new Date().toISOString(),
        deleted_at: '',
      }));

      // Write to storage
      await storage.vector.addDocuments(vectorDocs);

      // Inverted index entries
      const indexEntries = chunks.map(chunk => ({
        text: chunk.content,
        chunkId: chunk.id,
        locator: chunk.locator || '',
      }));
      if (convResult.searchableText?.length) {
        // Use searchableText if available (structured docs like Excel)
        for (const entry of convResult.searchableText) {
          indexEntries.push({ text: entry.text, chunkId: entry.chunkId || chunks[0]?.id || '', locator: entry.locator || '' });
        }
      }
      await storage.invertedIndex.addFile(fileId, directoryId, indexEntries);

      // Write AFD archive to S3
      await storage.archive.write(fileId, {
        files: {
          'content.md': convResult.markdown,
          'metadata.json': JSON.stringify({ mapping: convResult.mapping }),
        },
      });

      // Summary (optional, don't block on failure)
      let summary = '';
      try {
        const summaryResult = await summaryService.summarizeDocument(convResult.markdown);
        summary = summaryResult.summary || '';
        // Also write summary to archive
        await storage.archive.write(fileId, {
          files: { 'summaries.json': JSON.stringify({ documentSummary: summary }) },
        });
      } catch {
        // Summary failure is non-blocking
      }

      // 5. Update file record
      await pool.query(
        `UPDATE files SET status = 'indexed', chunk_count = $2, summary = $3, afd_key = $4, indexed_at = now()
         WHERE id = $1`,
        [fileId, chunks.length, summary, `${tenantId}/${fileId}`]
      );

      // 6. Cleanup
      rmSync(tempDir, { recursive: true, force: true });
      await deleteObject(s3TempKey); // Remove temp upload

      console.log(`Indexed: ${fileName} (${chunks.length} chunks)`);

    } catch (error: any) {
      console.error(`Failed to index ${fileName}:`, error);
      await pool.query(
        "UPDATE files SET status = 'failed', error_message = $2 WHERE id = $1",
        [fileId, error.message?.slice(0, 500)]
      );
    }
  });

  console.log('Worker listening for indexing jobs...');

  process.on('SIGINT', async () => {
    await embeddingService.dispose();
    await boss.stop();
    process.exit(0);
  });
}
```

- [ ] **Step 2: Commit**

---

### Task 4: SSE 索引进度端点

**Files:**
- Create: `packages/server/src/routes/indexing-event-routes.ts`

- [ ] **Step 1: Write SSE route**

```typescript
// packages/server/src/routes/indexing-event-routes.ts

import type { FastifyInstance } from 'fastify';
import { getPool } from '@agent-fs/storage-cloud';
import { createAuthMiddleware } from '../middleware/auth.js';

export async function indexingEventRoutes(app: FastifyInstance, jwtSecret: string) {
  const auth = createAuthMiddleware(jwtSecret);

  app.get('/projects/:projectId/indexing-events', { preHandler: auth }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const tenantId = request.user!.tenantId;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const pool = getPool();
    const interval = setInterval(async () => {
      try {
        const result = await pool.query(
          `SELECT f.id, f.name, f.status, f.chunk_count, f.error_message, f.indexed_at
           FROM files f JOIN directories d ON f.directory_id = d.id
           WHERE d.project_id = $1 AND f.tenant_id = $2
           ORDER BY f.created_at DESC LIMIT 50`,
          [projectId, tenantId]
        );
        reply.raw.write(`data: ${JSON.stringify({ files: result.rows })}\n\n`);
      } catch {
        // Client may have disconnected
      }
    }, 2000); // Poll every 2s

    request.raw.on('close', () => {
      clearInterval(interval);
    });
  });
}
```

- [ ] **Step 2: Register in app.ts + commit**

---

### Task 5: 补齐 files 表字段

- [ ] **Step 1: 在 Phase 3 migration SQL 中确保 files 表有以下字段**

```sql
ALTER TABLE files ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
```

（直接修改 `001-init-schema.sql`，在建表时就包含这些字段）

- [ ] **Step 2: Commit**

---

## Phase 4B Success Criteria

- [ ] 上传文件 → S3 临时路径 → pg-boss 入队 → Worker 消费
- [ ] Worker 真正执行：下载 → 插件转换 → chunk → embed → summary → CloudAdapter 写入
- [ ] 文件状态正确流转：pending → indexing → indexed | failed
- [ ] 失败记录 error_message，不影响其他文件
- [ ] SSE 端点推送文件状态变化
- [ ] Embedding/Summary service 全局单例，不在每个 job 中重建

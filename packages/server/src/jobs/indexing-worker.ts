// packages/server/src/jobs/indexing-worker.ts

import PgBoss from 'pg-boss';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  initDb,
  initS3,
  getPool,
  getObject,
  deleteObject,
  createCloudAdapter,
} from '@agent-fs/storage-cloud';
import { EmbeddingService } from '@agent-fs/llm';
import { SummaryService } from '@agent-fs/llm';
import { PluginManager } from '@agent-fs/indexer';
import { MarkdownChunker } from '@agent-fs/core';
import type { VectorDocument } from '@agent-fs/core';
import type { InvertedIndexEntry } from '@agent-fs/storage-adapter';
import { JOB_INDEX_FILE, type IndexFileJob } from './queue.js';
import type { ServerConfig } from '../config.js';
import { buildEmbeddingConfig } from '../services/embedding-config.js';

export async function startWorker(config: ServerConfig): Promise<void> {
  await initDb({ connectionString: config.databaseUrl });
  initS3({
    endpoint: config.s3Endpoint,
    bucket: config.s3Bucket,
    accessKeyId: config.s3AccessKey,
    secretAccessKey: config.s3SecretKey,
  });

  // Load embedding config from env (worker needs its own config)
  const embeddingConfig = buildEmbeddingConfig();
  const embeddingService = new EmbeddingService(embeddingConfig);
  await embeddingService.init();

  const summaryConfig = buildLLMConfig();
  const summaryService = summaryConfig ? new SummaryService(summaryConfig) : null;

  const pluginManager = buildPluginManager();

  const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 800 });

  const boss = new PgBoss(config.databaseUrl);
  await boss.start();

  await boss.work<IndexFileJob>(
    JOB_INDEX_FILE,
    { batchSize: 2, pollingIntervalSeconds: 2 },
    async (jobs) => {
      for (const job of jobs) {
        await processJob(job.data, embeddingService, summaryService, pluginManager, chunker);
      }
    },
  );

  console.log('Worker listening for indexing jobs...');

  process.on('SIGINT', async () => {
    await embeddingService.dispose();
    await boss.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await embeddingService.dispose();
    await boss.stop();
    process.exit(0);
  });
}

async function processJob(
  data: IndexFileJob,
  embeddingService: EmbeddingService,
  summaryService: SummaryService | null,
  pluginManager: PluginManager,
  chunker: MarkdownChunker,
): Promise<void> {
  const { tenantId, directoryId, fileId, fileName, s3TempKey } = data;
  const pool = getPool();

  try {
    await pool.query("UPDATE files SET status = 'indexing' WHERE id = $1", [fileId]);

    // 1. Download from S3 to temp dir
    const tempDir = join(tmpdir(), `agentfs-index-${fileId}`);
    mkdirSync(tempDir, { recursive: true });
    const tempFilePath = join(tempDir, fileName);
    const fileBuffer = await getObject(s3TempKey);
    writeFileSync(tempFilePath, fileBuffer);

    // 2. Get plugin by file extension
    const ext = extname(fileName).slice(1).toLowerCase();
    const plugin = pluginManager.getPlugin(ext);
    if (!plugin) {
      throw new Error(`No plugin registered for extension: .${ext}`);
    }

    // 3. Convert to markdown
    const convResult = await plugin.toMarkdown(tempFilePath);

    // 4. Chunk
    const chunkMetas = chunker.chunk(convResult.markdown);

    // 5. Embed chunks
    const embedResult = await embeddingService.embedBatch(
      chunkMetas.map((c) => c.content),
    );

    // 6. Build VectorDocuments
    const vectorDocs: VectorDocument[] = chunkMetas.map((chunk, i) => ({
      chunk_id: `${fileId}:${i}`,
      file_id: fileId,
      dir_id: directoryId,
      rel_path: fileName,
      file_path: fileName,
      chunk_line_start: chunk.lineStart,
      chunk_line_end: chunk.lineEnd,
      content_vector: embedResult.embeddings[i],
      locator: chunk.locator,
      indexed_at: new Date().toISOString(),
      deleted_at: '',
    }));

    // 7. Build inverted index entries
    const indexEntries: InvertedIndexEntry[] = chunkMetas.map((chunk, i) => ({
      text: chunk.content,
      chunkId: `${fileId}:${i}`,
      locator: chunk.locator,
    }));

    // 8. Write to cloud storage
    const adapter = createCloudAdapter({ tenantId });
    await adapter.init();

    try {
      await adapter.vector.addDocuments(vectorDocs);
      await adapter.invertedIndex.addFile(fileId, directoryId, indexEntries);

      // 9. Write archive
      await adapter.archive.write(fileId, {
        files: {
          'content.md': convResult.markdown,
          'metadata.json': JSON.stringify({ mapping: convResult.mapping }),
        },
      });
    } finally {
      await adapter.close();
    }

    // 10. Generate summary (non-blocking)
    let summary = '';
    if (summaryService) {
      try {
        const summaryResult = await summaryService.generateDocumentSummary(
          fileName,
          convResult.markdown,
        );
        summary = summaryResult.summary;
      } catch {
        // Summary failure is non-blocking
      }
    }

    // 11. Update file record
    await pool.query(
      `UPDATE files
       SET status = 'indexed', chunk_count = $2, summary = $3,
           afd_key = $4, indexed_at = now(), updated_at = now()
       WHERE id = $1`,
      [fileId, chunkMetas.length, summary, `${tenantId}/${fileId}`],
    );

    // 12. Cleanup temp files and S3 temp
    rmSync(tempDir, { recursive: true, force: true });
    try {
      await deleteObject(s3TempKey);
    } catch {
      // Non-blocking
    }

    console.log(`Indexed: ${fileName} (${chunkMetas.length} chunks)`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to index ${fileName}:`, error);

    // Cleanup partial writes so dirty data is not searchable
    try {
      const cleanupAdapter = createCloudAdapter({ tenantId });
      await cleanupAdapter.init();
      try {
        await cleanupAdapter.vector.deleteByFileId(fileId);
        await cleanupAdapter.invertedIndex.removeFile(fileId);
        await cleanupAdapter.archive.delete(fileId);
      } finally {
        await cleanupAdapter.close();
      }
    } catch {
      // Best-effort cleanup — do not mask original error
    }

    await pool.query(
      "UPDATE files SET status = 'failed', error_message = $2, updated_at = now() WHERE id = $1",
      [fileId, message.slice(0, 500)],
    );
  }
}

// ---------------------------------------------------------------------------
// Config helpers — read from env at worker startup
// ---------------------------------------------------------------------------

function buildLLMConfig() {
  const apiKey = process.env['LLM_API_KEY'];
  const baseUrl = process.env['LLM_BASE_URL'];
  const model = process.env['LLM_MODEL'];
  if (!apiKey || !baseUrl || !model) return null;
  return { provider: 'openai-compatible' as const, base_url: baseUrl, api_key: apiKey, model };
}

function buildPluginManager(): PluginManager {
  // PluginManager with no plugins registered — plugins must be loaded dynamically
  // In production, load plugins from @agent-fs/plugins package
  const manager = new PluginManager();
  tryLoadPlugins(manager);
  return manager;
}

function tryLoadPlugins(manager: PluginManager): void {
  // Attempt to load plugins package if available
  try {
    // Dynamic require to avoid hard dependency at compile time
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const plugins = require('@agent-fs/plugins');
    if (Array.isArray(plugins.default)) {
      for (const plugin of plugins.default) {
        manager.register(plugin);
      }
    } else if (plugins.registerPlugins) {
      plugins.registerPlugins(manager);
    }
  } catch {
    console.warn('No @agent-fs/plugins found — only plain text files will be indexed');
    // Register a simple plain-text fallback
    manager.register({
      name: 'plain-text',
      supportedExtensions: ['txt', 'md', 'markdown'],
      async toMarkdown(filePath: string) {
        const { readFileSync } = await import('node:fs');
        const content = readFileSync(filePath, 'utf-8');
        return { markdown: content, mapping: [] };
      },
    });
  }
}

// Suppress unused import warning
void randomUUID;

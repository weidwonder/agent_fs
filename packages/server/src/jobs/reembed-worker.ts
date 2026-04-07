import { MarkdownChunker } from '@agent-fs/core';
import type { EmbeddingService } from '@agent-fs/llm';
import { createCloudAdapter, getPool } from '@agent-fs/storage-cloud';
import type { ReembedFileJob } from './queue.js';

export async function processReembedJob(
  data: ReembedFileJob,
  embeddingService: EmbeddingService,
): Promise<void> {
  const { tenantId, fileId } = data;
  const pool = getPool();

  try {
    await pool.query(
      "UPDATE files SET status = 'embedding', updated_at = now() WHERE id = $1",
      [fileId],
    );

    const adapter = createCloudAdapter({ tenantId });
    await adapter.init();

    let contentMd: string;
    try {
      contentMd = await adapter.archive.read(fileId, 'content.md');
    } finally {
      await adapter.close();
    }

    const chunker = new MarkdownChunker({ minTokens: 200, maxTokens: 400 });
    const chunkMetas = chunker.chunk(contentMd);
    const embedResult = await embeddingService.embedBatch(chunkMetas.map((chunk) => chunk.content));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let index = 0; index < chunkMetas.length; index += 1) {
        const chunkId = `${fileId}:${index}`;
        const vector = `[${embedResult.embeddings[index].join(',')}]`;
        await client.query(
          'UPDATE chunks SET content_vector = $2::vector WHERE id = $1',
          [chunkId, vector],
        );
      }
      await client.query(
        "UPDATE files SET status = 'indexed', updated_at = now() WHERE id = $1",
        [fileId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

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

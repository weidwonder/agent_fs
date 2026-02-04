import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { loadConfig } from '@agent-fs/core';
import type { EmbeddingService } from '@agent-fs/llm';
import { createEmbeddingService } from '@agent-fs/llm';
import type { VectorStore, BM25Index, SearchFusion } from '@agent-fs/search';
import { createVectorStore, loadIndex, indexExists, createSearchFusion } from '@agent-fs/search';

interface SearchInput {
  query: string;
  keyword?: string;
  scope: string | string[];
  top_k?: number;
}

let embeddingService: EmbeddingService | null = null;
let vectorStore: VectorStore | null = null;
let bm25Index: BM25Index | null = null;
let searchFusion: SearchFusion | null = null;

export async function initSearchService(): Promise<void> {
  if (searchFusion) return;

  const config = loadConfig();
  const storagePath = join(homedir(), '.agent_fs', 'storage');

  if (!existsSync(join(storagePath, 'vectors'))) {
    console.error('Warning: Vector storage not found. Search will not work until indexing is done.');
    return;
  }

  embeddingService = createEmbeddingService(config.embedding);
  await embeddingService.init();

  vectorStore = createVectorStore({
    storagePath: join(storagePath, 'vectors'),
    dimension: embeddingService.getDimension(),
  });
  await vectorStore.init();

  const bm25Path = join(storagePath, 'bm25', 'index.json');
  if (indexExists(bm25Path)) {
    bm25Index = loadIndex(bm25Path);
  } else {
    const { BM25Index: BM25IndexClass } = await import('@agent-fs/search');
    bm25Index = new BM25IndexClass();
  }

  searchFusion = createSearchFusion(vectorStore, bm25Index, embeddingService);
}

export async function disposeSearchService(): Promise<void> {
  if (vectorStore) {
    await vectorStore.close();
    vectorStore = null;
  }
  if (embeddingService) {
    await embeddingService.dispose();
    embeddingService = null;
  }
  bm25Index = null;
  searchFusion = null;
}

export function getVectorStore(): VectorStore {
  if (!vectorStore) {
    throw new Error('Search service not initialized. No indexes available.');
  }
  return vectorStore;
}

export async function search(input: SearchInput) {
  if (!searchFusion) {
    throw new Error('Search service not initialized. Please index some directories first.');
  }

  const response = await searchFusion.search({
    query: input.query,
    keyword: input.keyword,
    scope: input.scope,
    topK: input.top_k ?? 10,
  });

  return {
    results: response.results.map((r) => ({
      chunk_id: r.chunkId,
      score: r.score,
      content: r.content,
      summary: r.summary,
      source: {
        file_path: r.source.filePath,
        locator: r.source.locator,
      },
    })),
    meta: {
      total_searched: response.meta.totalSearched,
      fusion_method: response.meta.fusionMethod,
      elapsed_ms: response.meta.elapsedMs,
    },
  };
}

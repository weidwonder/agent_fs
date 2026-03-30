import type { VectorDocument } from '@agent-fs/core';
import type { VectorStore } from '@agent-fs/search';
import type {
  VectorStoreAdapter,
  VectorSearchParams,
  VectorSearchResult,
} from '../types.js';

export class LocalVectorStoreAdapter implements VectorStoreAdapter {
  constructor(private readonly store: VectorStore) {}

  async init(): Promise<void> {
    await this.store.init();
  }

  async addDocuments(docs: VectorDocument[]): Promise<void> {
    await this.store.addDocuments(docs);
  }

  async searchByVector(params: VectorSearchParams): Promise<VectorSearchResult[]> {
    const { vector, dirIds, topK, minResultsBeforeFallback } = params;
    const results = await this.store.searchByContent(vector, {
      topK,
      dirIds,
      distanceType: 'cosine',
      minResultsBeforeFallback,
    });

    return results.map((r) => ({
      chunkId: r.chunk_id,
      score: r.score,
      document: r.document,
    }));
  }

  async getByChunkIds(chunkIds: string[]): Promise<VectorDocument[]> {
    return this.store.getByChunkIds(chunkIds);
  }

  async deleteByFileId(fileId: string): Promise<void> {
    await this.store.deleteByFileId(fileId);
  }

  async deleteByDirId(dirId: string): Promise<void> {
    await this.store.deleteByDirId(dirId);
  }

  async deleteByDirIds(dirIds: string[]): Promise<void> {
    await this.store.deleteByDirIds(dirIds);
  }

  async close(): Promise<void> {
    await this.store.close();
  }
}

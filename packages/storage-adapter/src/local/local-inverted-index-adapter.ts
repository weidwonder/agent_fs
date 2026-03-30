import type { InvertedIndex } from '@agent-fs/search';
import type {
  InvertedIndexAdapter,
  InvertedIndexEntry,
  InvertedSearchResult,
} from '../types.js';

export class LocalInvertedIndexAdapter implements InvertedIndexAdapter {
  constructor(private readonly index: InvertedIndex) {}

  async init(): Promise<void> {
    await this.index.init();
  }

  async addFile(
    fileId: string,
    dirId: string,
    entries: InvertedIndexEntry[],
  ): Promise<void> {
    // InvertedIndex.addFile accepts IndexEntry[] which has same shape as InvertedIndexEntry
    await this.index.addFile(fileId, dirId, entries);
  }

  async search(params: {
    terms: string[];
    dirIds: string[];
    topK: number;
  }): Promise<InvertedSearchResult[]> {
    const { terms, dirIds, topK } = params;
    // InvertedIndex.search takes a query string, join terms with spaces
    const query = terms.join(' ');
    const results = await this.index.search(query, { dirIds, topK });

    return results.map((r) => ({
      chunkId: r.chunkId,
      fileId: r.fileId,
      dirId: r.dirId,
      score: r.score,
      locator: r.locator,
    }));
  }

  async removeFile(fileId: string): Promise<void> {
    await this.index.removeFile(fileId);
  }

  async removeDirectory(dirId: string): Promise<void> {
    await this.index.removeDirectory(dirId);
  }

  async removeDirectories(dirIds: string[]): Promise<void> {
    await this.index.removeDirectories(dirIds);
  }

  async close(): Promise<void> {
    await this.index.close();
  }
}

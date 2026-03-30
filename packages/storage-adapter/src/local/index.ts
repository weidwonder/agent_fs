import { join } from 'node:path';
import { VectorStore, InvertedIndex } from '@agent-fs/search';
import { AFDStorage } from '@agent-fs/storage';
import type { StorageAdapter } from '../types.js';
import { LocalVectorStoreAdapter } from './local-vector-store-adapter.js';
import { LocalInvertedIndexAdapter } from './local-inverted-index-adapter.js';
import { LocalArchiveAdapter } from './local-archive-adapter.js';
import { LocalMetadataAdapter } from './local-metadata-adapter.js';

export { LocalVectorStoreAdapter } from './local-vector-store-adapter.js';
export { LocalInvertedIndexAdapter } from './local-inverted-index-adapter.js';
export { LocalArchiveAdapter } from './local-archive-adapter.js';
export { LocalMetadataAdapter } from './local-metadata-adapter.js';

export interface LocalAdapterOptions {
  /** Base directory for all local storage data */
  storagePath: string;
  /** Vector embedding dimension */
  dimension: number;
  /** Optional: path to registry.json (defaults to ~/.agent_fs/registry.json) */
  registryPath?: string;
}

/**
 * Creates a StorageAdapter backed by local file system stores.
 * Caller must invoke `init()` before use and `close()` when done.
 */
export function createLocalAdapter(options: LocalAdapterOptions): StorageAdapter {
  const { storagePath, dimension, registryPath } = options;

  const vectorStore = new VectorStore({
    storagePath: join(storagePath, 'vectors'),
    dimension,
  });

  const invertedIndex = new InvertedIndex({
    dbPath: join(storagePath, 'inverted-index', 'inverted-index.db'),
  });

  const archiveStorage = new AFDStorage({
    documentsDir: join(storagePath, 'archives'),
  });

  const metadataDir = join(storagePath, 'metadata');

  const vector = new LocalVectorStoreAdapter(vectorStore);
  const invertedIndexAdapter = new LocalInvertedIndexAdapter(invertedIndex);
  const archive = new LocalArchiveAdapter(archiveStorage);
  const metadata = new LocalMetadataAdapter({ metadataDir, registryPath });

  return {
    vector,
    invertedIndex: invertedIndexAdapter,
    archive,
    metadata,

    async init(): Promise<void> {
      await vector.init();
      await invertedIndexAdapter.init();
    },

    async close(): Promise<void> {
      await vector.close();
      await invertedIndexAdapter.close();
      await archive.close();
    },
  };
}

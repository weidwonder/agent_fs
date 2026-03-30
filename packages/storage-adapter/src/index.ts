export type {
  VectorDocument,
  IndexMetadata,
  VectorSearchParams,
  VectorSearchResult,
  VectorStoreAdapter,
  InvertedIndexEntry,
  InvertedSearchResult,
  InvertedIndexAdapter,
  DocumentArchiveAdapter,
  MetadataAdapter,
  StorageAdapter,
} from './types.js';

export {
  LocalVectorStoreAdapter,
  LocalInvertedIndexAdapter,
  LocalArchiveAdapter,
  LocalMetadataAdapter,
  createLocalAdapter,
  type LocalAdapterOptions,
} from './local/index.js';

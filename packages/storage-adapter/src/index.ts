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
  ClueAdapter,
  StorageAdapter,
} from './types.js';

export {
  LocalVectorStoreAdapter,
  LocalInvertedIndexAdapter,
  LocalArchiveAdapter,
  LocalMetadataAdapter,
  LocalClueAdapter,
  createLocalAdapter,
  type LocalAdapterOptions,
} from './local/index.js';

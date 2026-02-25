// @agent-fs/search
export const VERSION = '0.1.0';

// BM25
export {
  BM25Index,
  tokenize,
  termFrequency,
  saveIndex,
  loadIndex,
  indexExists,
  bm25Score,
  DEFAULT_BM25_PARAMS,
  type BM25IndexOptions,
  type BM25SearchOptions,
  type TokenizeOptions,
  type BM25Params,
} from './bm25';

export { VectorStore, createVectorStore } from './vector-store';
export type { VectorStoreOptions, VectorSearchOptions } from './vector-store';

// Fusion
export {
  SearchFusion,
  createSearchFusion,
  fusionRRF,
  rrfScore,
  DEFAULT_RRF_PARAMS,
  aggregateTopByFile,
} from './fusion';
export type {
  FusionOptions,
  RRFParams,
  RankedItem,
  FusedItem,
  FileAggregationOptions,
  FileAggregatedItem,
} from './fusion';

// Inverted Index
export * from './inverted-index';

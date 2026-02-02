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

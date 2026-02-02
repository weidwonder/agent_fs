// @agent-fs/core
// 核心类型定义导出

export const VERSION = '0.1.0';

// Plugin types
export type {
  DocumentPlugin,
  DocumentConversionResult,
  PositionMapping,
  LocatorInfo,
} from './types/plugin';

// Chunk types
export type { Chunk, ChunkMetadata, ChunkResult, ChunkerOptions } from './types/chunk';

// Config types
export type {
  Config,
  LLMConfig,
  EmbeddingConfig,
  LocalEmbeddingConfig,
  APIEmbeddingConfig,
  RerankConfig,
  IndexingConfig,
  SearchConfig,
} from './types/config';

// Search types
export type {
  SearchResult,
  SearchOptions,
  SearchFilters,
  SearchMeta,
  SearchResponse,
} from './types/search';

// Index types
export type {
  IndexMetadata,
  IndexStats,
  FileMetadata,
  SubdirectoryInfo,
  Registry,
  RegisteredDirectory,
} from './types/index-meta';

// Storage types
export type {
  VectorDocument,
  BM25Document,
  VectorSearchResult,
  BM25SearchResult,
} from './types/storage';

// Config
export {
  loadConfig,
  configExists,
  getDefaultConfigPath,
  configSchema,
  validateConfig,
  loadEnvFiles,
  resolveEnvVariables,
  type LoadConfigOptions,
  type ResolvedConfig,
} from './config';

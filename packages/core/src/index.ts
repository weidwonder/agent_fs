// @agent-fs/core
// 核心类型定义导出

export const VERSION = '0.1.0';

// Plugin types
export type {
  DocumentPlugin,
  DocumentConversionResult,
  SearchableEntry,
  PositionMapping,
  LocatorInfo,
} from './types/plugin';

// Chunk types
export type { Chunk, ChunkMetadata, ChunkResult, ChunkerOptions } from './types/chunk';

// Config types
export type {
  Config,
  SummaryMode,
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

// Clue types
export type {
  Segment,
  ClueFolder,
  ClueLeaf,
  ClueNode,
  Clue,
  ClueSummary,
  ClueReference,
} from './types/clue';

// Index types
export type {
  IndexMetadata,
  IndexStats,
  FileMetadata,
  SubdirectoryInfo,
  Registry,
  RegisteredProject,
  SubdirectoryRef,
} from './types/index-meta';

// Storage types
export type {
  VectorDocument,
  BM25Document,
  VectorSearchResult,
  BM25SearchResult,
} from './types/storage';

export {
  MarkdownChunker,
  countTokens,
  createTokenizer,
  splitBySentences,
  splitLargeBlock,
  type Tokenizer,
  type TokenizerOptions,
  type SentenceSplitOptions,
  type SentenceChunk,
} from './chunker';

// Config
export {
  loadConfig,
  configExists,
  getDefaultConfigPath,
  configSchema,
  validateConfig,
  loadEnvFiles,
  resolveEnvVariables,
  readRawConfig,
  saveConfig,
  type LoadConfigOptions,
  type ResolvedConfig,
  type RawConfigResult,
} from './config';

export {
  createClue,
  findNode,
  addChild,
  updateNode,
  removeNode,
  listLeaves,
  renderTree,
  type CreateClueInput,
  type UpdateNodeInput,
  type RenderTreeOptions,
} from './clue/tree';

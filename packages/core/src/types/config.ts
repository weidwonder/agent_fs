/**
 * 完整配置
 */
export interface Config {
  /** LLM 配置 */
  llm: LLMConfig;

  /** Embedding 配置 */
  embedding: EmbeddingConfig;

  /** Rerank 配置 */
  rerank?: RerankConfig;

  /** 索引配置 */
  indexing: IndexingConfig;

  /** 搜索配置 */
  search: SearchConfig;

  /** 插件配置 */
  plugins?: Record<string, unknown>;
}

/**
 * LLM 配置
 */
export interface LLMConfig {
  /** 提供商类型 */
  provider: 'openai-compatible';

  /** API 地址 */
  base_url: string;

  /** API 密钥 */
  api_key: string;

  /** 模型名称 */
  model: string;
}

/**
 * Embedding 配置
 */
export interface EmbeddingConfig {
  /** 默认模式：local 或 api */
  default: 'local' | 'api';

  /** 本地模型配置 */
  local?: LocalEmbeddingConfig;

  /** API 模型配置 */
  api?: APIEmbeddingConfig;
}

/**
 * 本地 Embedding 配置
 */
export interface LocalEmbeddingConfig {
  /** 模型名称 */
  model: string;

  /** 设备：cpu 或 gpu */
  device: 'cpu' | 'gpu';
}

/**
 * API Embedding 配置
 */
export interface APIEmbeddingConfig {
  /** 提供商类型 */
  provider: 'openai-compatible';

  /** API 地址 */
  base_url: string;

  /** API 密钥 */
  api_key: string;

  /** 模型名称 */
  model: string;
}

/**
 * Rerank 配置
 */
export interface RerankConfig {
  /** 是否启用 */
  enabled: boolean;

  /** 提供商类型 */
  provider: 'llm';
}

/**
 * 索引配置
 */
export interface IndexingConfig {
  /** Chunk 大小配置 */
  chunk_size: {
    min_tokens: number;
    max_tokens: number;
  };
}

/**
 * 搜索配置
 */
export interface SearchConfig {
  /** 默认返回数量 */
  default_top_k: number;

  /** 融合配置 */
  fusion: {
    method: 'rrf';
  };
}

import { z } from 'zod';

/**
 * LLM 配置 schema
 */
const llmConfigSchema = z.object({
  provider: z.literal('openai-compatible'),
  base_url: z.string().url(),
  api_key: z.string().min(1),
  model: z.string().min(1),
});

/**
 * 本地 Embedding 配置 schema
 */
const localEmbeddingSchema = z.object({
  model: z.string().min(1),
  device: z.enum(['cpu', 'gpu']).default('cpu'),
});

/**
 * API Embedding 配置 schema
 */
const apiEmbeddingSchema = z.object({
  provider: z.literal('openai-compatible'),
  base_url: z.string().url(),
  api_key: z.string().min(1),
  model: z.string().min(1),
  timeout_ms: z.number().int().positive().default(60000),
  max_retries: z.number().int().min(1).max(8).default(3),
  batch_size: z.number().int().positive().max(64).default(24),
});

/**
 * Embedding 配置 schema
 */
const embeddingConfigSchema = z.object({
  default: z.enum(['local', 'api']),
  local: localEmbeddingSchema.optional(),
  api: apiEmbeddingSchema.optional(),
});

/**
 * Rerank 配置 schema
 */
const rerankConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.literal('llm'),
});

/**
 * Summary 配置 schema
 */
const summaryConfigSchema = z.object({
  mode: z.enum(['batch', 'skip']).default('batch'),
  parallel_requests: z.number().int().positive().max(8).default(2),
  timeout_ms: z.number().int().positive().default(45000),
  max_retries: z.number().int().min(0).max(2).optional(),
});

/**
 * 索引配置 schema
 */
const indexingConfigSchema = z.object({
  chunk_size: z.object({
    min_tokens: z.number().int().positive().default(400),
    max_tokens: z.number().int().positive().default(800),
  }),
  file_parallelism: z.number().int().positive().max(8).default(2),
});

/**
 * 搜索配置 schema
 */
const searchConfigSchema = z.object({
  default_top_k: z.number().int().positive().default(10),
  fusion: z.object({
    method: z.literal('rrf'),
  }),
});

/**
 * 完整配置 schema
 */
export const configSchema = z.object({
  llm: llmConfigSchema,
  embedding: embeddingConfigSchema,
  rerank: rerankConfigSchema.optional(),
  summary: summaryConfigSchema.default({
    mode: 'batch',
    parallel_requests: 2,
    timeout_ms: 45000,
  }),
  indexing: indexingConfigSchema,
  search: searchConfigSchema,
  plugins: z.record(z.string(), z.unknown()).optional(),
});

/**
 * 解析后的配置类型
 */
export type ResolvedConfig = z.infer<typeof configSchema>;

/**
 * 验证配置
 */
export function validateConfig(config: unknown): ResolvedConfig {
  return configSchema.parse(config);
}

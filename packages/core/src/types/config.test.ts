import { describe, it, expectTypeOf } from 'vitest';
import type {
  Config,
  LLMConfig,
  EmbeddingConfig,
  APIEmbeddingConfig,
  IndexingConfig,
  SearchConfig,
} from './config';

describe('Config Types', () => {
  it('LLMConfig 使用 snake_case 字段', () => {
    expectTypeOf<LLMConfig>().toHaveProperty('base_url');
    expectTypeOf<LLMConfig>().toHaveProperty('api_key');
  });

  it('EmbeddingConfig 使用 snake_case 字段', () => {
    expectTypeOf<EmbeddingConfig>().toHaveProperty('default');
    expectTypeOf<APIEmbeddingConfig>().toHaveProperty('base_url');
    expectTypeOf<APIEmbeddingConfig>().toHaveProperty('api_key');
    expectTypeOf<APIEmbeddingConfig>().toHaveProperty('timeout_ms');
    expectTypeOf<APIEmbeddingConfig>().toHaveProperty('max_retries');
  });

  it('IndexingConfig 与 SearchConfig 使用 snake_case 字段', () => {
    expectTypeOf<IndexingConfig>().toHaveProperty('chunk_size');
    expectTypeOf<SearchConfig>().toHaveProperty('default_top_k');
  });

  it('Config 可用 snake_case 结构赋值', () => {
    const config: Config = {
      llm: {
        provider: 'openai-compatible',
        base_url: 'https://api.openai.com/v1',
        api_key: 'sk-test',
        model: 'gpt-4o-mini',
      },
      embedding: {
        default: 'local',
        local: {
          model: 'bge-small-zh-v1.5',
          device: 'cpu',
        },
      },
      indexing: {
        chunk_size: {
          min_tokens: 400,
          max_tokens: 800,
        },
      },
      search: {
        default_top_k: 10,
        fusion: { method: 'rrf' },
      },
    };

    expectTypeOf(config.llm.base_url).toBeString();
    expectTypeOf(config.indexing.chunk_size.min_tokens).toBeNumber();
  });
});

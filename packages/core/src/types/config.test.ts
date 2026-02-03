import { describe, it, expectTypeOf } from 'vitest';
import type {
  LLMConfig,
  EmbeddingConfig,
  APIEmbeddingConfig,
  IndexingConfig,
  SearchConfig,
} from './config';

describe('Config Types', () => {
  it('should accept snake_case fields for llm config', () => {
    const llm: LLMConfig = {
      provider: 'openai-compatible',
      base_url: 'https://api.test.com/v1',
      api_key: 'test-key',
      model: 'test-model',
    };

    expectTypeOf(llm.provider).toBeString();
  });

  it('should accept snake_case fields for embedding api config', () => {
    const embedding: EmbeddingConfig = {
      default: 'api',
      api: {
        provider: 'openai-compatible',
        base_url: 'https://api.test.com/v1',
        api_key: 'test-key',
        model: 'test-model',
      },
    };

    expectTypeOf(embedding.default).toBeString();
  });

  it('should accept snake_case fields for indexing and search config', () => {
    const indexing: IndexingConfig = {
      chunk_size: {
        min_tokens: 600,
        max_tokens: 1200,
      },
    };

    const search: SearchConfig = {
      default_top_k: 10,
      fusion: { method: 'rrf' },
    };

    expectTypeOf(indexing.chunk_size.min_tokens).toBeNumber();
    expectTypeOf(search.default_top_k).toBeNumber();
  });
});

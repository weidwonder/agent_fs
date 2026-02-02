import { describe, it, expect } from 'vitest';
import { validateConfig } from './schema';
import { ZodError } from 'zod';

describe('configSchema', () => {
  const validConfig = {
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
        min_tokens: 600,
        max_tokens: 1200,
      },
    },
    search: {
      default_top_k: 10,
      fusion: {
        method: 'rrf',
      },
    },
  };

  it('should validate a correct config', () => {
    const result = validateConfig(validConfig);
    expect(result.llm.provider).toBe('openai-compatible');
    expect(result.embedding.default).toBe('local');
  });

  it('should reject missing required fields', () => {
    const invalidConfig = { ...validConfig, llm: undefined };
    expect(() => validateConfig(invalidConfig)).toThrow(ZodError);
  });

  it('should reject invalid URL', () => {
    const invalidConfig = {
      ...validConfig,
      llm: { ...validConfig.llm, base_url: 'not-a-url' },
    };
    expect(() => validateConfig(invalidConfig)).toThrow(ZodError);
  });

  it('should reject invalid provider', () => {
    const invalidConfig = {
      ...validConfig,
      llm: { ...validConfig.llm, provider: 'invalid' },
    };
    expect(() => validateConfig(invalidConfig)).toThrow(ZodError);
  });

  it('should apply default values', () => {
    const minConfig = {
      llm: validConfig.llm,
      embedding: { default: 'local' },
      indexing: { chunk_size: {} },
      search: { fusion: { method: 'rrf' } },
    };
    const result = validateConfig(minConfig);
    expect(result.indexing.chunk_size.min_tokens).toBe(600);
    expect(result.indexing.chunk_size.max_tokens).toBe(1200);
    expect(result.search.default_top_k).toBe(10);
  });

  it('should allow optional rerank config', () => {
    const configWithRerank = {
      ...validConfig,
      rerank: {
        enabled: true,
        provider: 'llm',
      },
    };
    const result = validateConfig(configWithRerank);
    expect(result.rerank?.enabled).toBe(true);
  });

  it('should allow optional plugins config', () => {
    const configWithPlugins = {
      ...validConfig,
      plugins: {
        pdf: { extra_param: 'value' },
      },
    };
    const result = validateConfig(configWithPlugins);
    expect(result.plugins?.pdf).toEqual({ extra_param: 'value' });
  });
});

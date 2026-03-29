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
        min_tokens: 400,
        max_tokens: 800,
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
    expect(result.indexing.chunk_size.min_tokens).toBe(400);
    expect(result.indexing.chunk_size.max_tokens).toBe(800);
    expect(result.indexing.file_parallelism).toBe(2);
    expect(result.search.default_top_k).toBe(10);
  });

  it('should apply default embedding API timeout and retries', () => {
    const apiConfig = {
      llm: validConfig.llm,
      embedding: {
        default: 'api',
        api: {
          provider: 'openai-compatible',
          base_url: 'https://api.openai.com/v1',
          api_key: 'sk-test',
          model: 'text-embedding-3-small',
        },
      },
      indexing: { chunk_size: {} },
      search: { fusion: { method: 'rrf' } },
    };

    const result = validateConfig(apiConfig);
    expect(result.embedding.api?.timeout_ms).toBe(60000);
    expect(result.embedding.api?.max_retries).toBe(3);
  });

  it('should keep custom embedding API timeout and retries', () => {
    const apiConfig = {
      llm: validConfig.llm,
      embedding: {
        default: 'api',
        api: {
          provider: 'openai-compatible',
          base_url: 'https://api.openai.com/v1',
          api_key: 'sk-test',
          model: 'text-embedding-3-small',
          timeout_ms: 120000,
          max_retries: 5,
        },
      },
      indexing: { chunk_size: {} },
      search: { fusion: { method: 'rrf' } },
    };

    const result = validateConfig(apiConfig);
    expect(result.embedding.api?.timeout_ms).toBe(120000);
    expect(result.embedding.api?.max_retries).toBe(5);
  });

  it('should apply default summary config', () => {
    const minConfig = {
      llm: validConfig.llm,
      embedding: { default: 'local' },
      indexing: { chunk_size: {} },
      search: { fusion: { method: 'rrf' } },
    };
    const result = validateConfig(minConfig);
    expect(result.summary?.mode).toBe('batch');
    expect(result.summary?.parallel_requests).toBe(2);
    expect(result.summary?.timeout_ms).toBe(45000);
  });

  it('should reject invalid summary mode', () => {
    const invalidConfig = {
      ...validConfig,
      summary: { mode: 'invalid' },
    };
    expect(() => validateConfig(invalidConfig)).toThrow(ZodError);
  });

  it('should reject invalid summary parallel_requests', () => {
    const invalidConfig = {
      ...validConfig,
      summary: { parallel_requests: 0 },
    };
    expect(() => validateConfig(invalidConfig)).toThrow(ZodError);
  });

  it('should reject invalid embedding api timeout', () => {
    const invalidConfig = {
      llm: validConfig.llm,
      embedding: {
        default: 'api',
        api: {
          provider: 'openai-compatible',
          base_url: 'https://api.openai.com/v1',
          api_key: 'sk-test',
          model: 'text-embedding-3-small',
          timeout_ms: 0,
        },
      },
      indexing: { chunk_size: {} },
      search: { fusion: { method: 'rrf' } },
    };
    expect(() => validateConfig(invalidConfig)).toThrow(ZodError);
  });

  it('should reject invalid indexing file_parallelism', () => {
    const invalidConfig = {
      ...validConfig,
      indexing: {
        chunk_size: validConfig.indexing.chunk_size,
        file_parallelism: 0,
      },
    };
    expect(() => validateConfig(invalidConfig)).toThrow(ZodError);
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

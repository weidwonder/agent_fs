import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EmbeddingConfig } from '@agent-fs/core';
import type { EmbeddingService as EmbeddingServiceType } from './service';

const apiProviderConstructorSpy = vi.hoisted(() => vi.fn());

vi.mock('./api-provider', () => {
  class APIEmbeddingProvider {
    constructor(options: unknown) {
      apiProviderConstructorSpy(options);
    }

    init = vi.fn().mockResolvedValue(undefined);
    embed = vi.fn().mockImplementation((text: string) =>
      Promise.resolve(new Array(512).fill(0).map((_, i) => i + text.length))
    );
    embedBatch = vi.fn().mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map((text) => new Array(512).fill(0).map((_, i) => i + text.length)))
    );
    getDimension = vi.fn().mockResolvedValue(512);
    dispose = vi.fn().mockResolvedValue(undefined);
  }

  return { APIEmbeddingProvider };
});

vi.mock('./local-provider', () => {
  class LocalEmbeddingProvider {
    init = vi.fn().mockResolvedValue(undefined);
    embed = vi.fn().mockResolvedValue([]);
    embedBatch = vi.fn().mockResolvedValue([]);
    getDimension = vi.fn().mockResolvedValue(0);
    dispose = vi.fn().mockResolvedValue(undefined);
  }

  return { LocalEmbeddingProvider };
});

describe('EmbeddingService', () => {
  const apiConfig: EmbeddingConfig = {
    default: 'api',
    api: {
      provider: 'openai-compatible',
      base_url: 'https://api.test.com/v1',
      api_key: 'test-key',
      model: 'text-embedding-3-small',
      timeout_ms: 45000,
      max_retries: 4,
    },
  };

  let service: EmbeddingServiceType;

  beforeEach(async () => {
    vi.resetModules();
    apiProviderConstructorSpy.mockClear();
    const module = await import('./service');
    service = new module.EmbeddingService(apiConfig);
    await service.init();
  });

  it('should initialize and get dimension', () => {
    expect(service.getDimension()).toBe(512);
  });

  it('should generate embedding for single text', async () => {
    const embedding = await service.embed('hello');
    expect(embedding).toHaveLength(512);
  });

  it('should cache embeddings', async () => {
    const text = 'cached text';

    await service.embed(text);

    const result = await service.embedBatch([text]);
    expect(result.cacheHits).toBe(1);
    expect(result.computations).toBe(0);
  });

  it('should handle batch embedding', async () => {
    const texts = ['a', 'b', 'c'];
    const result = await service.embedBatch(texts);

    expect(result.embeddings).toHaveLength(3);
    expect(result.computations).toBe(3);
  });

  it('should bypass cache when disabled', async () => {
    const text = 'no cache';

    await service.embed(text, { useCache: false });
    const result = await service.embedBatch([text], { useCache: false });

    expect(result.cacheHits).toBe(0);
    expect(result.computations).toBe(1);
  });

  it('should clear cache', async () => {
    await service.embed('text');
    service.clearCache();

    expect(service.getCacheStats().size).toBe(0);
  });

  it('should pass timeout and retries to API provider', () => {
    expect(apiProviderConstructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 45000,
        maxRetries: 4,
      })
    );
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { EmbeddingCache } from './cache';

describe('EmbeddingCache', () => {
  let cache: EmbeddingCache;

  beforeEach(() => {
    cache = new EmbeddingCache('test-model');
  });

  it('should store and retrieve embeddings', () => {
    const embedding = [1, 2, 3, 4, 5];
    cache.set('hello', embedding);
    expect(cache.get('hello')).toEqual(embedding);
  });

  it('should return undefined for missing keys', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('should use model name in cache key', () => {
    const cache1 = new EmbeddingCache('model-a');
    const cache2 = new EmbeddingCache('model-b');

    cache1.set('hello', [1, 2, 3]);
    cache2.set('hello', [4, 5, 6]);

    expect(cache1.get('hello')).toEqual([1, 2, 3]);
    expect(cache2.get('hello')).toEqual([4, 5, 6]);
  });

  it('should handle batch operations', () => {
    const texts = ['a', 'b', 'c'];
    const embeddings = [[1], [2], [3]];

    cache.setMany(texts, embeddings);

    const results = cache.getMany(texts);
    expect(results).toEqual(embeddings);
  });

  it('should clear cache', () => {
    cache.set('hello', [1, 2, 3]);
    cache.clear();
    expect(cache.get('hello')).toBeUndefined();
  });

  it('should track stats', () => {
    cache.set('a', [1, 2, 3]);
    cache.set('b', [4, 5, 6]);

    expect(cache.stats.size).toBe(2);
  });
});

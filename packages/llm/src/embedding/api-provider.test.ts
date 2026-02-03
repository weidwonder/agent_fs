import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { APIEmbeddingProvider } from './api-provider';

describe('APIEmbeddingProvider', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    const fetchMock = vi.fn();
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;
  });

  afterEach(() => {
    (globalThis as unknown as { fetch?: typeof fetch }).fetch = originalFetch;
    vi.useRealTimers();
  });

  it('should send request and sort results by index', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { embedding: [2, 2], index: 1 },
          { embedding: [1, 1], index: 0 },
        ],
      }),
    });

    const provider = new APIEmbeddingProvider({
      base_url: 'https://api.test.com/v1',
      api_key: 'test-key',
      model: 'text-embedding-3-small',
      maxRetries: 1,
    });

    const result = await provider.embedBatch(['a', 'b']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test.com/v1/embeddings');
    expect(options?.method).toBe('POST');
    expect(options?.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-key',
    });

    const body = JSON.parse(options?.body as string);
    expect(body).toEqual({
      model: 'text-embedding-3-small',
      input: ['a', 'b'],
    });

    expect(result).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it('should retry on failure', async () => {
    vi.useFakeTimers();

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [1, 2, 3], index: 0 }],
        }),
      });

    const provider = new APIEmbeddingProvider({
      base_url: 'https://api.test.com/v1',
      api_key: 'test-key',
      model: 'text-embedding-3-small',
      maxRetries: 2,
    });

    const promise = provider.embedBatch(['retry']);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual([[1, 2, 3]]);
  });
});

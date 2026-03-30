// packages/server/src/services/embedding-config.ts

/**
 * Builds EmbeddingService config from environment variables.
 * Used by both app.ts (HTTP server) and indexing-worker.ts.
 */
export function buildEmbeddingConfig() {
  const apiKey = process.env['EMBEDDING_API_KEY'];
  const baseUrl = process.env['EMBEDDING_BASE_URL'];
  const model = process.env['EMBEDDING_MODEL'] ?? 'text-embedding-3-small';

  if (apiKey && baseUrl) {
    return {
      default: 'api' as const,
      api: {
        provider: 'openai-compatible' as const,
        base_url: baseUrl,
        api_key: apiKey,
        model,
        timeout_ms: 30000,
        max_retries: 3,
      },
    };
  }

  const localModel = process.env['EMBEDDING_LOCAL_MODEL'] ?? 'BAAI/bge-small-zh-v1.5';
  return {
    default: 'local' as const,
    local: { model: localModel, device: 'cpu' as const },
  };
}

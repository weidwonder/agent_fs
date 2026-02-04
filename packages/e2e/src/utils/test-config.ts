import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@agent-fs/core';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export const TEST_DATA_DIR = join(__dirname, '../../../../test-data');

export const TEST_TEMP_PREFIX = 'agent-fs-e2e-';

export const TEST_FILES = {
  markdown: 'INDIR2511IN03148_D16&D17.md',
  pdf1: 'INDIR2511IN02996_D13&D15_origin.pdf',
  pdf2: 'INDIR2512IN01019_D22,D23,F2,F3_origin.pdf',
};

const FALLBACK_CONFIG = {
  embedding: {
    default: 'api' as const,
    api: {
      base_url: 'http://localhost:11434/v1',
      api_key: 'ollama',
      model: 'nomic-embed-text',
    },
  },
  llm: {
    provider: 'openai-compatible' as const,
    base_url: 'http://localhost:11434/v1',
    api_key: 'ollama',
    model: 'qwen2.5:7b',
  },
  indexing: {
    chunkSize: {
      minTokens: 200,
      maxTokens: 800,
    },
  },
};

let resolvedConfig: ReturnType<typeof loadConfig> | null = null;
try {
  resolvedConfig = loadConfig();
} catch {
  resolvedConfig = null;
}

export const MOCK_CONFIG = {
  embedding: resolvedConfig?.embedding ?? FALLBACK_CONFIG.embedding,
  llm: resolvedConfig?.llm ?? FALLBACK_CONFIG.llm,
  indexing: {
    chunkSize: {
      minTokens:
        resolvedConfig?.indexing.chunk_size.min_tokens ??
        FALLBACK_CONFIG.indexing.chunkSize.minTokens,
      maxTokens:
        resolvedConfig?.indexing.chunk_size.max_tokens ??
        FALLBACK_CONFIG.indexing.chunkSize.maxTokens,
    },
  },
};

export async function checkLLMAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${MOCK_CONFIG.llm.base_url}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${MOCK_CONFIG.llm.api_key}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export const TEST_DATA_DIR = join(__dirname, '../../../../test-data');

export const TEST_TEMP_PREFIX = 'agent-fs-e2e-';

export const TEST_FILES = {
  markdown: 'INDIR2511IN03148_D16&D17.md',
  pdf1: 'INDIR2511IN02996_D13&D15_origin.pdf',
  pdf2: 'INDIR2512IN01019_D22,D23,F2,F3_origin.pdf',
};

const LLM_BASE_URL =
  process.env.AGENT_FS_LLM_BASE_URL ?? 'https://open.bigmodel.cn/api/coding/paas/v4';
const EMBEDDING_BASE_URL =
  process.env.AGENT_FS_EMBEDDING_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4';
const API_KEY = process.env.AGENT_FS_LLM_API_KEY ?? '';
const EMBEDDING_API_KEY = process.env.AGENT_FS_EMBEDDING_API_KEY ?? API_KEY;
const LLM_MODEL = process.env.AGENT_FS_LLM_MODEL ?? 'GLM-4.5-air';
const EMBEDDING_MODEL = process.env.AGENT_FS_EMBEDDING_MODEL ?? 'embedding-3';

export const MOCK_CONFIG = {
  embedding: {
    default: 'api' as const,
    api: {
      provider: 'openai-compatible' as const,
      base_url: EMBEDDING_BASE_URL,
      api_key: EMBEDDING_API_KEY,
      model: EMBEDDING_MODEL,
    },
  },
  llm: {
    provider: 'openai-compatible' as const,
    base_url: LLM_BASE_URL,
    api_key: API_KEY,
    model: LLM_MODEL,
  },
  indexing: {
    chunk_size: {
      min_tokens: 200,
      max_tokens: 800,
    },
  },
};

async function checkEndpoint(url: string, init: RequestInit): Promise<boolean> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function checkLLMAvailable(): Promise<boolean> {
  if (!API_KEY || !LLM_BASE_URL || !EMBEDDING_BASE_URL) {
    return false;
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_KEY}`,
  };

  const modelsOk = await checkEndpoint(`${LLM_BASE_URL}/models`, {
    method: 'GET',
    headers,
  });

  const chatOk = modelsOk
    ? true
    : await checkEndpoint(`${LLM_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: LLM_MODEL,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          temperature: 0,
        }),
      });

  if (!chatOk) {
    return false;
  }

  const embeddingOk = await checkEndpoint(`${EMBEDDING_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${EMBEDDING_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: 'ping',
    }),
  });

  return embeddingOk;
}

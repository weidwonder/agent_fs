import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, configExists } from './loader';

describe('loadConfig', () => {
  const testDir = join(tmpdir(), 'agent-fs-test-' + Date.now());
  const configPath = join(testDir, 'config.yaml');
  const envPath = join(testDir, '.env');
  const originalCwd = process.cwd();

  const validYaml = `
llm:
  provider: openai-compatible
  base_url: https://api.openai.com/v1
  api_key: \${TEST_API_KEY}
  model: gpt-4o-mini

embedding:
  default: local
  local:
    model: bge-small-zh-v1.5
    device: cpu

indexing:
  chunk_size:
    min_tokens: 600
    max_tokens: 1200

search:
  default_top_k: 10
  fusion:
    method: rrf
`;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env.TEST_API_KEY = 'sk-test-key';
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.TEST_API_KEY;
  });

  it('should load config from file', () => {
    writeFileSync(configPath, validYaml);
    const config = loadConfig({ configPath, loadEnv: false });
    expect(config.llm.api_key).toBe('sk-test-key');
    expect(config.embedding.default).toBe('local');
  });

  it('should throw error for missing file', () => {
    expect(() => loadConfig({ configPath: '/nonexistent/path.yaml' })).toThrow(
      'Config file not found'
    );
  });

  it('should resolve env variables from .env file', () => {
    writeFileSync(configPath, validYaml);
    writeFileSync(envPath, 'TEST_API_KEY=from-dotenv');

    delete process.env.TEST_API_KEY;

    process.chdir(testDir);

    const config = loadConfig({ configPath, loadEnv: true });
    expect(config.llm.api_key).toBe('from-dotenv');
  });

  it('should throw error for invalid config', () => {
    const invalidYaml = `
llm:
  provider: invalid-provider
`;
    writeFileSync(configPath, invalidYaml);
    expect(() => loadConfig({ configPath, loadEnv: false })).toThrow();
  });
});

describe('configExists', () => {
  const testDir = join(tmpdir(), 'agent-fs-test-exists-' + Date.now());
  const configPath = join(testDir, 'config.yaml');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should return true for existing file', () => {
    writeFileSync(configPath, 'test: true');
    expect(configExists(configPath)).toBe(true);
  });

  it('should return false for missing file', () => {
    expect(configExists('/nonexistent/path.yaml')).toBe(false);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadEnvFiles, resolveEnvVariables } from './env';

describe('resolveEnvVariables', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should replace single env variable in string', () => {
    process.env.TEST_VAR = 'test_value';
    const result = resolveEnvVariables('${TEST_VAR}');
    expect(result).toBe('test_value');
  });

  it('should replace multiple env variables in string', () => {
    process.env.VAR1 = 'hello';
    process.env.VAR2 = 'world';
    const result = resolveEnvVariables('${VAR1} ${VAR2}');
    expect(result).toBe('hello world');
  });

  it('should throw error for missing env variable', () => {
    expect(() => resolveEnvVariables('${MISSING_VAR}')).toThrow(
      'Environment variable not found: MISSING_VAR'
    );
  });

  it('should recursively resolve nested objects', () => {
    process.env.API_KEY = 'secret123';
    const config = {
      llm: {
        api_key: '${API_KEY}',
        model: 'gpt-4',
      },
    };
    const result = resolveEnvVariables(config);
    expect(result).toEqual({
      llm: {
        api_key: 'secret123',
        model: 'gpt-4',
      },
    });
  });

  it('should handle arrays', () => {
    process.env.ITEM = 'value';
    const arr = ['${ITEM}', 'static'];
    const result = resolveEnvVariables(arr);
    expect(result).toEqual(['value', 'static']);
  });

  it('should pass through non-string primitives', () => {
    expect(resolveEnvVariables(123)).toBe(123);
    expect(resolveEnvVariables(true)).toBe(true);
    expect(resolveEnvVariables(null)).toBe(null);
  });

  it('loadEnvFiles should load .env quietly without writing stdout', () => {
    const originalCwd = process.cwd();
    const tempDir = mkdtempSync(join(tmpdir(), 'agent-fs-env-'));
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(join(tempDir, '.env'), 'LOCAL_ONLY_VAR=from-local-env\n');
      delete process.env.LOCAL_ONLY_VAR;

      process.chdir(tempDir);
      loadEnvFiles();

      expect(process.env.LOCAL_ONLY_VAR).toBe('from-local-env');
      expect(stdoutSpy).not.toHaveBeenCalled();
    } finally {
      stdoutSpy.mockRestore();
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
      delete process.env.LOCAL_ONLY_VAR;
    }
  });
});

import { describe, expect, it } from 'vitest';

import { sanitizeForLog } from './log-sanitizer';

describe('sanitizeForLog', () => {
  it('应脱敏嵌套 api_key 字段且不修改原对象', () => {
    const input = {
      default: 'api',
      api: {
        provider: 'openai-compatible',
        base_url: 'https://example.com',
        api_key: 'sk-test-123456',
        model: 'embedding-2',
      },
    };

    const output = sanitizeForLog(input);

    expect(output).toEqual({
      default: 'api',
      api: {
        provider: 'openai-compatible',
        base_url: 'https://example.com',
        api_key: '[REDACTED]',
        model: 'embedding-2',
      },
    });
    expect(input.api.api_key).toBe('sk-test-123456');
  });

  it('应脱敏常见敏感字段并保留非敏感字段', () => {
    const input = {
      authToken: 'token-abc',
      headers: {
        Authorization: 'Bearer 123',
      },
      timeout_ms: 60000,
      max_tokens: 2048,
    };

    const output = sanitizeForLog(input);

    expect(output).toEqual({
      authToken: '[REDACTED]',
      headers: {
        Authorization: '[REDACTED]',
      },
      timeout_ms: 60000,
      max_tokens: 2048,
    });
  });
});

import { describe, it, expect } from 'vitest';
import { countTokens, createTokenizer } from './tokenizer';

describe('countTokens', () => {
  it('should count English tokens', () => {
    const count = countTokens('Hello, world!');
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10);
  });

  it('should count Chinese tokens', () => {
    const count = countTokens('你好，世界！');
    expect(count).toBeGreaterThan(0);
  });

  it('should handle empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('should handle long text', () => {
    const longText = 'Hello world. '.repeat(100);
    const count = countTokens(longText);
    expect(count).toBeGreaterThan(100);
  });
});

describe('createTokenizer', () => {
  it('should create a tokenizer with count method', () => {
    const tokenizer = createTokenizer();
    expect(tokenizer.count('test')).toBeGreaterThan(0);
  });

  it('should encode and decode correctly', () => {
    const tokenizer = createTokenizer();
    const text = 'Hello, world!';
    const tokens = tokenizer.encode(text);
    const decoded = tokenizer.decode(tokens);
    expect(decoded).toBe(text);
  });
});

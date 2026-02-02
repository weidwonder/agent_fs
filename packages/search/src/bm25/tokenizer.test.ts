import { describe, it, expect } from 'vitest';
import { tokenize, termFrequency } from './tokenizer';

describe('tokenize', () => {
  it('should tokenize Chinese text', () => {
    const tokens = tokenize('今天天气很好');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toContain('今天');
    expect(tokens).toContain('天气');
  });

  it('should tokenize English text', () => {
    const tokens = tokenize('Hello world, this is a test');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
    expect(tokens).toContain('test');
  });

  it('should remove stop words by default', () => {
    const tokens = tokenize('我是一个学生');
    expect(tokens).not.toContain('是');
  });

  it('should keep stop words when disabled', () => {
    const tokens = tokenize('The quick brown fox', { removeStopWords: false });
    expect(tokens).toContain('the');
  });

  it('should convert to lowercase by default', () => {
    const tokens = tokenize('Hello WORLD');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
  });

  it('should filter punctuation', () => {
    const tokens = tokenize('你好，世界！');
    expect(tokens).not.toContain('，');
    expect(tokens).not.toContain('！');
  });

  it('should handle mixed content', () => {
    const tokens = tokenize('Python是一种编程语言');
    expect(tokens).toContain('python');
    expect(tokens).toContain('编程');
    expect(tokens).toContain('语言');
  });

  it('should handle empty text', () => {
    expect(tokenize('')).toHaveLength(0);
  });
});

describe('termFrequency', () => {
  it('should count term frequencies', () => {
    const tokens = ['hello', 'world', 'hello'];
    const freq = termFrequency(tokens);
    expect(freq.get('hello')).toBe(2);
    expect(freq.get('world')).toBe(1);
  });

  it('should handle empty array', () => {
    const freq = termFrequency([]);
    expect(freq.size).toBe(0);
  });
});

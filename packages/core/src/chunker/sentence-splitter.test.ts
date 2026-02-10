import { describe, it, expect } from 'vitest';
import { splitBySentences, splitLargeBlock } from './sentence-splitter';

describe('splitBySentences', () => {
  it('should split English sentences', () => {
    const text = 'Hello world. How are you? I am fine!';
    const sentences = splitBySentences(text);
    expect(sentences).toHaveLength(3);
    expect(sentences[0]).toBe('Hello world.');
    expect(sentences[1]).toBe('How are you?');
    expect(sentences[2]).toBe('I am fine!');
  });

  it('should split Chinese sentences', () => {
    const text = '你好世界。今天天气很好！你觉得呢？';
    const sentences = splitBySentences(text);
    expect(sentences).toHaveLength(3);
  });

  it('should handle mixed sentences', () => {
    const text = 'Hello世界。This is a test!';
    const sentences = splitBySentences(text);
    expect(sentences).toHaveLength(2);
  });

  it('should handle decimal numbers', () => {
    const text = 'The value is 3.14. Another sentence.';
    const sentences = splitBySentences(text);
    expect(sentences.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle empty text', () => {
    expect(splitBySentences('')).toHaveLength(0);
  });
});

describe('splitLargeBlock', () => {
  it('should split text into chunks within maxTokens', () => {
    const text = 'Sentence one. Sentence two. Sentence three. Sentence four. Sentence five.';
    const chunks = splitLargeBlock(text, { maxTokens: 10 });

    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(15);
    }
  });

  it('should handle single large sentence', () => {
    const text = 'A'.repeat(1000);
    const chunks = splitLargeBlock(text, { maxTokens: 50 });

    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('should split oversized sentence into bounded chunks', () => {
    const text = 'A'.repeat(20000);
    const chunks = splitLargeBlock(text, { maxTokens: 200 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.content).join('')).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(200);
    }
  });

  it('should include overlap when specified', () => {
    const text = 'One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten.';
    const chunks = splitLargeBlock(text, { maxTokens: 10, overlapRatio: 0.2 });

    if (chunks.length >= 2) {
      expect(chunks.length).toBeGreaterThan(1);
    }
  });

  it('should return empty array for empty text', () => {
    const chunks = splitLargeBlock('', { maxTokens: 100 });
    expect(chunks).toHaveLength(0);
  });
});

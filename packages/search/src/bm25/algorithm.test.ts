import { describe, it, expect } from 'vitest';
import { idf, bm25TermScore, bm25Score } from './algorithm';

describe('idf', () => {
  it('should return higher score for rare terms', () => {
    const rareIdf = idf(1000, 10);
    const commonIdf = idf(1000, 500);
    expect(rareIdf).toBeGreaterThan(commonIdf);
  });

  it('should handle edge cases', () => {
    expect(idf(100, 0)).toBeGreaterThan(0);
    expect(idf(100, 100)).toBeLessThan(idf(100, 50));
  });
});

describe('bm25TermScore', () => {
  it('should return positive score for matching term', () => {
    const score = bm25TermScore(3, 100, 100, 2.0);
    expect(score).toBeGreaterThan(0);
  });

  it('should return 0 for zero term frequency', () => {
    const score = bm25TermScore(0, 100, 100, 2.0);
    expect(score).toBe(0);
  });

  it('should give higher score for higher term frequency', () => {
    const lowTf = bm25TermScore(1, 100, 100, 2.0);
    const highTf = bm25TermScore(5, 100, 100, 2.0);
    expect(highTf).toBeGreaterThan(lowTf);
  });

  it('should normalize by document length', () => {
    const shortDoc = bm25TermScore(3, 50, 100, 2.0);
    const longDoc = bm25TermScore(3, 200, 100, 2.0);
    expect(shortDoc).toBeGreaterThan(longDoc);
  });
});

describe('bm25Score', () => {
  it('should calculate total score for query', () => {
    const queryTerms = ['hello', 'world'];
    const docTermFreq = new Map([
      ['hello', 2],
      ['world', 1],
    ]);
    const docFreqs = new Map([
      ['hello', 5],
      ['world', 10],
    ]);

    const score = bm25Score(queryTerms, docTermFreq, 100, 100, docFreqs, 100);
    expect(score).toBeGreaterThan(0);
  });

  it('should return 0 for non-matching query', () => {
    const queryTerms = ['foo', 'bar'];
    const docTermFreq = new Map([
      ['hello', 2],
      ['world', 1],
    ]);
    const docFreqs = new Map([
      ['hello', 5],
      ['world', 10],
    ]);

    const score = bm25Score(queryTerms, docTermFreq, 100, 100, docFreqs, 100);
    expect(score).toBe(0);
  });

  it('should handle empty query', () => {
    const score = bm25Score([], new Map(), 100, 100, new Map(), 100);
    expect(score).toBe(0);
  });
});

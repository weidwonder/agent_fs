import { describe, expect, it } from 'vitest';

import { IndexEntryBuilder, tokenizeText } from './index-builder';

describe('tokenizeText', () => {
  it('过滤停用词和标点', () => {
    const tokens = tokenizeText('你好 世界 的 the and !!!');

    expect(tokens).toContain('你好');
    expect(tokens).toContain('世界');
    expect(tokens).not.toContain('的');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('and');
    expect(tokens.some((token) => token.includes('!'))).toBe(false);
  });
});

describe('IndexEntryBuilder', () => {
  it('构建条目并跳过空 terms', () => {
    const builder = new IndexEntryBuilder();
    const built = builder.buildEntries([
      { text: '你好 世界', chunkId: 'c1', locator: 'lines:1-1' },
      { text: '的 the and', chunkId: 'c2', locator: 'lines:2-2' },
    ]);

    expect(built).toHaveLength(1);
    expect(built[0].chunkId).toBe('c1');
    expect(built[0].terms.length).toBeGreaterThan(0);
  });
});

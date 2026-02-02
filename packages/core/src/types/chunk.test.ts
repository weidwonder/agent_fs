import { describe, it, expectTypeOf } from 'vitest';
import type { Chunk, ChunkerOptions } from './chunk';

describe('Chunk Types', () => {
  it('Chunk interface should have required properties', () => {
    expectTypeOf<Chunk>().toHaveProperty('id');
    expectTypeOf<Chunk>().toHaveProperty('content');
    expectTypeOf<Chunk>().toHaveProperty('summary');
    expectTypeOf<Chunk>().toHaveProperty('tokenCount');
  });

  it('ChunkerOptions should have min and max tokens', () => {
    const options: ChunkerOptions = {
      minTokens: 600,
      maxTokens: 1200,
      overlapRatio: 0.1,
    };
    expectTypeOf(options.minTokens).toBeNumber();
    expectTypeOf(options.maxTokens).toBeNumber();
  });
});

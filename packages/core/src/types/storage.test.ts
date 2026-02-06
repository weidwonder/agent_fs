import { describe, it, expectTypeOf } from 'vitest';
import type { VectorDocument } from './storage';

describe('Storage Types', () => {
  it('VectorDocument should use line range fields', () => {
    expectTypeOf<VectorDocument>().toHaveProperty('chunk_line_start');
    expectTypeOf<VectorDocument>().toHaveProperty('chunk_line_end');
  });

  it('VectorDocument should not include raw text fields', () => {
    expectTypeOf<VectorDocument>().not.toHaveProperty('content');
    expectTypeOf<VectorDocument>().not.toHaveProperty('summary');
  });
});

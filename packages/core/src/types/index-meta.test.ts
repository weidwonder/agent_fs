import { describe, it, expectTypeOf } from 'vitest';
import type { IndexMetadata, Registry } from './index-meta';

describe('IndexMeta Types', () => {
  it('IndexMetadata should include hierarchy fields', () => {
    expectTypeOf<IndexMetadata>().toHaveProperty('projectId');
    expectTypeOf<IndexMetadata>().toHaveProperty('relativePath');
    expectTypeOf<IndexMetadata>().toHaveProperty('parentDirId');
  });

  it('FileMetadata should not expose chunkIds', () => {
    type File = IndexMetadata['files'][number];
    expectTypeOf<File>().not.toHaveProperty('chunkIds');
    expectTypeOf<File>().toHaveProperty('hash');
  });

  it('Registry should expose projects', () => {
    expectTypeOf<Registry>().toHaveProperty('projects');
  });
});

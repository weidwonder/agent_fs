import { describe, expect, it } from 'vitest';

import { DirectoryResolver } from './directory-resolver';

describe('DirectoryResolver', () => {
  it('项目 ID 展开为全部子目录', () => {
    const resolver = new DirectoryResolver([
      {
        projectId: 'p1',
        subdirectories: [
          { dirId: 'd1', relativePath: 'a' },
          { dirId: 'd2', relativePath: 'b' },
        ],
      },
    ]);

    const expanded = resolver.expandDirIds(['p1']);
    expect(expanded).toEqual(expect.arrayContaining(['p1', 'd1', 'd2']));
  });

  it('子目录 ID 展开为当前目录及其后代', () => {
    const resolver = new DirectoryResolver([
      {
        projectId: 'p1',
        subdirectories: [
          { dirId: 'd1', relativePath: 'a' },
          { dirId: 'd2', relativePath: 'a/b' },
          { dirId: 'd3', relativePath: 'a/b/c' },
          { dirId: 'd4', relativePath: 'x' },
        ],
      },
    ]);

    const expanded = resolver.expandDirIds(['d2']);
    expect(expanded).toEqual(expect.arrayContaining(['d2', 'd3']));
    expect(expanded).not.toContain('d1');
    expect(expanded).not.toContain('d4');
  });
});

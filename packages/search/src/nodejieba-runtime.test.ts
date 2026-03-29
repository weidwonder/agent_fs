import { describe, expect, it } from 'vitest';

import { resolveUnpackedAsarPath } from './nodejieba-runtime';

describe('resolveUnpackedAsarPath', () => {
  it('在 asar 目录存在解包文件时优先返回解包路径', () => {
    const input =
      '/Applications/Agent FS.app/Contents/Resources/app.asar/node_modules/nodejieba/dict/jieba.dict.utf8';
    const output = resolveUnpackedAsarPath(
      input,
      (candidate) => candidate.includes('app.asar.unpacked')
    );

    expect(output).toContain('app.asar.unpacked');
  });

  it('在非 asar 路径时保持原路径', () => {
    const input =
      '/Users/weidwonder/projects/agent_fs/node_modules/nodejieba/dict/jieba.dict.utf8';

    expect(resolveUnpackedAsarPath(input, () => true)).toBe(input);
  });
});

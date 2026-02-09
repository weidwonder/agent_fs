import { describe, expect, it } from 'vitest';
import { resolveRendererDevUrl } from './renderer-url';

describe('resolveRendererDevUrl', () => {
  it('开发模式应优先使用 ELECTRON_RENDERER_URL', () => {
    const url = resolveRendererDevUrl({
      NODE_ENV: 'development',
      ELECTRON_RENDERER_URL: 'http://localhost:3967',
    });

    expect(url).toBe('http://localhost:3967');
  });

  it('开发模式未注入时应抛错，避免误连其他项目', () => {
    expect(() =>
      resolveRendererDevUrl({
        NODE_ENV: 'development',
      })
    ).toThrowError(/ELECTRON_RENDERER_URL/u);
  });

  it('非开发模式不返回 dev url', () => {
    const url = resolveRendererDevUrl({
      NODE_ENV: 'production',
      ELECTRON_RENDERER_URL: 'http://localhost:3967',
    });

    expect(url).toBeNull();
  });
});

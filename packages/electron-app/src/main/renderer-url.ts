type RendererEnv = Pick<NodeJS.ProcessEnv, 'NODE_ENV' | 'ELECTRON_RENDERER_URL'>;

export function resolveRendererDevUrl(env: RendererEnv = process.env): string | null {
  if (env.NODE_ENV !== 'development') {
    return null;
  }

  const rendererUrl = env.ELECTRON_RENDERER_URL?.trim();
  if (!rendererUrl) {
    throw new Error('开发模式缺少 ELECTRON_RENDERER_URL，请通过 electron-vite dev 启动。');
  }

  return rendererUrl;
}

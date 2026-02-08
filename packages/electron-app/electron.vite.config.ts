import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        external: [
          '@agent-fs/indexer',
          '@agent-fs/core',
          '@agent-fs/search',
          '@agent-fs/llm',
          '@agent-fs/storage',
          'nodejieba',
          'better-sqlite3',
          '@xenova/transformers',
          '@lancedb/lancedb',
        ],
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
    },
  },
  renderer: {
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
    },
  },
});

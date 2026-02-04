import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.e2e.ts'],
    testTimeout: 120000,
    hookTimeout: 60000,
  },
});

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: {
      DB_PATH: ':memory:',
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
    },
    fileParallelism: false,
  },
});

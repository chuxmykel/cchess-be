import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

import { requireEnvFileValue } from './vitest.env.js';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: {
      DB_HOST: requireEnvFileValue('TEST_DB_HOST'),
      DB_PORT: requireEnvFileValue('TEST_DB_PORT'),
      DB_USERNAME: requireEnvFileValue('TEST_DB_USERNAME'),
      DB_PASSWORD: requireEnvFileValue('TEST_DB_PASSWORD'),
      DB_NAME: requireEnvFileValue('TEST_DB_NAME'),
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
    },
    fileParallelism: false,
  },
});

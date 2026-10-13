import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

import { requireEnvFileValue } from './vitest.env.js';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    env: {
      DB_NAME: requireEnvFileValue('TEST_DB_NAME'),
    },
    fileParallelism: false,
  },
});

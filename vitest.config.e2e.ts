import { defineConfig } from 'vitest/config';

import { requireEnvFileValue } from './vitest.env.js';

export default defineConfig({
  resolve: { tsconfigPaths: true },
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
      // Pinned regardless of the dev .env's own value (e.g. set >1)
      // cluster.util.ts now loads .env directly (see its
      // own comment), and a test process has no primary/worker IPC for
      // isMine()/ownerIndex() routing to actually reach.
      CLUSTER_WORKERS: '1',
      // Games always start from the usual position here, whatever test
      // position the dev .env sets.
      GAME_START_FEN: '',
      // No test ever reaches lichess, whatever the dev .env holds: the
      // explorer's lichess client is replaced by a fake where it's tested.
      LICHESS_TOKEN: '',
      LICHESS_EXPLORER_URL: 'http://127.0.0.1:9',
      // Tests run the upkeep themselves, so it never races their rows.
      EXPLORER_MAINTENANCE: 'false',
    },
    fileParallelism: false,
  },
});

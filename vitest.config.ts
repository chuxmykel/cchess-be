import { defineConfig } from 'vitest/config';

/** Where anything trying to reach a server from a unit test is pointed:
 * nothing listens on the discard port, so it's refused at once. */
const NOWHERE_HOST = '127.0.0.1';
const NOWHERE_PORT = '9';

// Unit specs only: no database, network, Redis or .env. Anything that
// needs a running service is an e2e spec (test/**/*.e2e-spec.ts, run by
// `npm run test:e2e`).
export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library` - native since Vite 6, so no plugin needed.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    env: {
      // cluster.util.ts loads .env on import, and dotenv never overwrites
      // a var that's already set - so these keep the dev .env's database
      // and Redis out of a unit test, and anything that does try to
      // connect fails rather than touching a real one.
      DB_HOST: NOWHERE_HOST,
      DB_PORT: NOWHERE_PORT,
      DB_USERNAME: 'unit-tests-have-no-database',
      DB_PASSWORD: 'unit-tests-have-no-database',
      DB_NAME: 'unit-tests-have-no-database',
      REDIS_HOST: NOWHERE_HOST,
      REDIS_PORT: NOWHERE_PORT,
      REDIS_PASSWORD: '',
      // A test process has no primary/worker IPC for isMine()/ownerIndex()
      // routing to reach, whatever the dev .env sets.
      CLUSTER_WORKERS: '1',
      // Games always start from the usual position here, whatever test
      // position the dev .env sets.
      GAME_START_FEN: '',
      // No test ever reaches lichess, whatever the dev .env holds.
      LICHESS_TOKEN: '',
      LICHESS_EXPLORER_URL: `http://${NOWHERE_HOST}:${NOWHERE_PORT}`,
      EXPLORER_MAINTENANCE: 'false',
    },
  },
});

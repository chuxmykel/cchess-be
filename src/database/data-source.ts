import { DataSource } from 'typeorm';

import { requireEnv } from '../common/require-env.js';

/**
 * Plain TypeORM DataSource for the CLI (migration:generate/run/revert) -
 * outside Nest's DI, so env vars are read directly rather than through
 * ConfigService. Run with `node --env-file=.env` (see package.json scripts)
 * so this picks up the same values the app itself uses.
 *
 * No fallback defaults on purpose - a missing/misconfigured .env should
 * fail loudly here rather than silently running migrations against some
 * guessed-at host/database, or baking a dev password into source control.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: requireEnv('DB_HOST'),
  port: Number(requireEnv('DB_PORT')),
  username: requireEnv('DB_USERNAME'),
  password: requireEnv('DB_PASSWORD'),
  database: requireEnv('DB_NAME'),
  // Glob instead of a manually maintained class list - picks up every
  // *.entity.js under dist/ automatically, so a new entity needs no edit
  // here. Only ever runs after `npm run build` (see package.json's
  // migration scripts), so dist/ is always present and current by the
  // time this resolves.
  entities: ['dist/**/*.entity.js'],
  migrations: ['dist/database/migrations/*.js'],
  synchronize: false,
});

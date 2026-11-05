import { DataSource, type DataSourceOptions } from 'typeorm';
import type { SeederOptions } from 'typeorm-extension';

import { requireEnv } from '../common/require-env.js';

/**
 * Plain TypeORM DataSource for the CLIs - TypeORM's
 * (migration:generate/run/revert) and typeorm-extension's (seed:run) -
 * outside Nest's DI, so env vars are read directly rather than through
 * ConfigService. Run with `node --env-file=.env` (see package.json scripts)
 * so this picks up the same values the app itself uses.
 *
 * No fallback defaults on purpose - a missing/misconfigured .env should
 * fail loudly here rather than silently running migrations or seeders
 * against some guessed-at host/database, or baking a dev password into
 * source control.
 */
const options: DataSourceOptions & SeederOptions = {
  type: 'postgres',
  host: requireEnv('DB_HOST'),
  port: Number(requireEnv('DB_PORT')),
  username: requireEnv('DB_USERNAME'),
  password: requireEnv('DB_PASSWORD'),
  database: requireEnv('DB_NAME'),
  // Glob instead of a manually maintained class list - picks up every
  // *.entity.js under dist/ automatically, so a new entity needs no edit
  // here. Only ever runs after `npm run build` (see package.json's
  // migration and seed scripts), so dist/ is always present and current by
  // the time this resolves.
  entities: ['dist/**/*.entity.js'],
  migrations: ['dist/database/migrations/*.js'],
  // typeorm-extension's seeders (`npm run seed:run`) - dev data, never
  // production; data every environment needs belongs in a migration. Each
  // runs once, recorded in the `seeds` table as migrations are in
  // `migrations`.
  seeds: ['dist/database/seeds/*.js'],
  seedTracking: true,
  factories: ['dist/database/factories/*.js'],
  synchronize: false,
};

export const AppDataSource = new DataSource(options);

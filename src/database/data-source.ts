import { DataSource } from 'typeorm';

import { RefreshToken } from '../auth/entities/refresh-token.entity.js';
import { Challenge } from '../challenges/entities/challenge.entity.js';
import { Friendship } from '../friends/entities/friendship.entity.js';
import { Game } from '../games/entities/game.entity.js';
import { Move } from '../games/entities/move.entity.js';
import { Rating } from '../users/entities/rating.entity.js';
import { User } from '../users/entities/user.entity.js';

/**
 * Plain TypeORM DataSource for the CLI (migration:generate/run/revert) -
 * outside Nest's DI, so env vars are read directly rather than through
 * ConfigService. Run with `node --env-file=.env` (see package.json scripts)
 * so this picks up the same values the app itself uses.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'cchess',
  password: process.env.DB_PASSWORD ?? 'cchess_dev_password',
  database: process.env.DB_NAME ?? 'cchess_be',
  entities: [User, Rating, RefreshToken, Friendship, Game, Move, Challenge],
  migrations: ['dist/database/migrations/*.js'],
  synchronize: false,
});

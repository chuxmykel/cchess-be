import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RefreshToken } from '../auth/entities/refresh-token.entity.js';
import { Challenge } from '../challenges/entities/challenge.entity.js';
import {
  CLUSTER_WORKERS,
  CLUSTERING_ENABLED,
} from '../cluster/cluster.util.js';
import type { AppConfig } from '../config/configuration.js';
import { Friendship } from '../friends/entities/friendship.entity.js';
import { Game } from '../games/entities/game.entity.js';
import { Move } from '../games/entities/move.entity.js';
import { GameChatMessage } from '../games/entities/game-chat-message.entity.js';
import { Rating } from '../users/entities/rating.entity.js';
import { User } from '../users/entities/user.entity.js';

// The 'pg' driver's own unconfigured default pool size - the ceiling each
// worker's pool is scaled down from, never up past.
const PG_DEFAULT_POOL_SIZE = 10;
// Never scale a single worker's pool down below this, however many workers
// are running - diminishing returns below this are worse than the
// over-provisioning risk at high worker counts.
const MIN_POOL_SIZE_PER_WORKER = 2;
// Total connections budgeted across every worker's pool combined, chosen to
// stay well under Postgres's own default max_connections=100 regardless of
// CLUSTER_WORKERS (see the comment below for the incident this prevents).
const TOTAL_POOL_BUDGET = 60;

/**
 * TypeORM's Postgres connection - pulled out of AppModule so its own
 * @Module decorator reads as a plain list of modules rather than burying a
 * large inline factory in the middle of it. See CLAUDE.md for the migration
 * workflow and the pool-size formula's own reasoning.
 */
export const typeOrmModule = TypeOrmModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (configService: ConfigService<AppConfig, true>) => ({
    type: 'postgres' as const,
    host: configService.get('database.host', { infer: true }),
    port: configService.get('database.port', { infer: true }),
    username: configService.get('database.username', { infer: true }),
    password: configService.get('database.password', { infer: true }),
    database: configService.get('database.name', { infer: true }),
    entities: [
      User,
      Rating,
      RefreshToken,
      Friendship,
      Game,
      Move,
      Challenge,
      GameChatMessage,
    ],
    // Schema is managed by real migrations (src/database/migrations),
    // not synchronize - see CLAUDE.md for the migration workflow.
    synchronize: false,
    migrations: ['dist/database/migrations/*.js'],
    migrationsRun: true,
    // Each cluster worker is a separate process with its own pool - the
    // 'pg' driver's unconfigured default (10) multiplied by worker count
    // can blow past Postgres's max_connections well before any of this
    // app's own load shows up (confirmed: CLUSTER_WORKERS=10 hit "FATAL:
    // remaining connection slots are reserved" immediately on a default
    // max_connections=100 instance). Scale the per-worker pool down so
    // the total stays well under that regardless of worker count; a
    // single-process boot (the default) keeps the driver's own default.
    // DB_POOL_SIZE overrides this outright - e.g. when Postgres is on a
    // separate host from the app with its own max_connections headroom.
    ...(process.env.DB_POOL_SIZE
      ? { poolSize: Number(process.env.DB_POOL_SIZE) }
      : CLUSTERING_ENABLED
        ? {
            poolSize: Math.max(
              MIN_POOL_SIZE_PER_WORKER,
              Math.min(
                PG_DEFAULT_POOL_SIZE,
                Math.floor(TOTAL_POOL_BUDGET / CLUSTER_WORKERS),
              ),
            ),
          }
        : {}),
  }),
});

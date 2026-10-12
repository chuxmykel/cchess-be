import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { RefreshToken } from './auth/entities/refresh-token.entity.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { ChallengesModule } from './challenges/challenges.module.js';
import { Challenge } from './challenges/entities/challenge.entity.js';
import { ClusterModule } from './cluster/cluster.module.js';
import { CLUSTER_WORKERS, CLUSTERING_ENABLED } from './cluster/cluster.util.js';
import configuration, { type AppConfig } from './config/configuration.js';
import { Friendship } from './friends/entities/friendship.entity.js';
import { FriendsModule } from './friends/friends.module.js';
import { Game } from './games/entities/game.entity.js';
import { Move } from './games/entities/move.entity.js';
import { GamesModule } from './games/games.module.js';
import { MatchmakingModule } from './matchmaking/matchmaking.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { Rating } from './users/entities/rating.entity.js';
import { User } from './users/entities/user.entity.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    EventEmitterModule.forRoot(),
    ClusterModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => ({
        type: 'postgres' as const,
        host: configService.get('database.host', { infer: true }),
        port: configService.get('database.port', { infer: true }),
        username: configService.get('database.username', { infer: true }),
        password: configService.get('database.password', { infer: true }),
        database: configService.get('database.name', { infer: true }),
        entities: [User, Rating, RefreshToken, Friendship, Game, Move, Challenge],
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
            ? { poolSize: Math.max(2, Math.min(10, Math.floor(60 / CLUSTER_WORKERS))) }
            : {}),
      }),
    }),
    AuthModule,
    UsersModule,
    FriendsModule,
    GamesModule,
    MatchmakingModule,
    ChallengesModule,
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}

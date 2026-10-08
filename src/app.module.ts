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
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => ({
        type: 'better-sqlite3' as const,
        database: configService.get('database.path', { infer: true }),
        entities: [User, Rating, RefreshToken, Friendship, Game, Move, Challenge],
        // SQLite is a throwaway dev database here - synchronize is fine until
        // the planned swap to Postgres, at which point this should become
        // real migrations instead (see CLAUDE.md).
        synchronize: true,
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

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { AccountModule } from './account/account.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { BlocksModule } from './blocks/blocks.module.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { ChallengesModule } from './challenges/challenges.module.js';
import { ClusterModule } from './cluster/cluster.module.js';
import { DailySeeksModule } from './daily-seeks/daily-seeks.module.js';
import configuration from './config/configuration.js';
import { typeOrmModule } from './database/typeorm.module.js';
import { ExplorerModule } from './explorer/explorer.module.js';
import { FriendsModule } from './friends/friends.module.js';
import { GamesModule } from './games/games.module.js';
import { MailModule } from './mail/mail.module.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { MatchmakingModule } from './matchmaking/matchmaking.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { PresenceModule } from './presence/presence.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    EventEmitterModule.forRoot(),
    ClusterModule,
    MailModule,
    MaintenanceModule,
    PresenceModule,
    typeOrmModule,
    AuthModule,
    UsersModule,
    BlocksModule,
    // After UsersModule, so GET /users/me is matched before /users/:username.
    ProfilesModule,
    FriendsModule,
    MessagesModule,
    GamesModule,
    MatchmakingModule,
    ChallengesModule,
    DailySeeksModule,
    ExplorerModule,
    RealtimeModule,
    AccountModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}

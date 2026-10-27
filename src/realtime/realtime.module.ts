import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { FriendsModule } from '../friends/friends.module.js';
import { GamesModule } from '../games/games.module.js';
import { MatchmakingModule } from '../matchmaking/matchmaking.module.js';
import { UsersModule } from '../users/users.module.js';
import { RealtimeGateway } from './realtime.gateway.js';

@Module({
  imports: [
    AuthModule,
    FriendsModule,
    GamesModule,
    MatchmakingModule,
    UsersModule,
  ],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}

import { Module } from '@nestjs/common';

import { GamesModule } from '../games/games.module.js';
import { UsersModule } from '../users/users.module.js';
import { MatchmakingController } from './matchmaking.controller.js';
import { MatchmakingService } from './matchmaking.service.js';

@Module({
  imports: [GamesModule, UsersModule],
  controllers: [MatchmakingController],
  providers: [MatchmakingService],
  exports: [MatchmakingService],
})
export class MatchmakingModule {}

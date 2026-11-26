import { Module } from '@nestjs/common';

import { GamesModule } from '../games/games.module.js';
import { MatchmakingModule } from '../matchmaking/matchmaking.module.js';
import { UsersModule } from '../users/users.module.js';
import { AccountController } from './account.controller.js';
import { AccountDeletionService } from './account-deletion.service.js';

/** Things done to a whole account that reach into every other module -
 * kept out of UsersModule, which they'd make circular. */
@Module({
  imports: [UsersModule, GamesModule, MatchmakingModule],
  controllers: [AccountController],
  providers: [AccountDeletionService],
})
export class AccountModule {}

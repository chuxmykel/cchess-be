import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Game } from '../games/entities/game.entity.js';
import { Move } from '../games/entities/move.entity.js';
import { Rating } from '../users/entities/rating.entity.js';
import { User } from '../users/entities/user.entity.js';
import { BadgesController } from './badges.controller.js';
import { BadgesService } from './badges.service.js';
import { UserBadge } from './entities/user-badge.entity.js';

/** Badges: awarded when a game ends and when its review is saved, listed
 * on profiles and on a game's result card. */
@Module({
  imports: [TypeOrmModule.forFeature([UserBadge, Game, Move, User, Rating])],
  controllers: [BadgesController],
  providers: [BadgesService],
  exports: [BadgesService],
})
export class BadgesModule {}

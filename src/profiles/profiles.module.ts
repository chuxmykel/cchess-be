import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FriendsModule } from '../friends/friends.module.js';
import { Game } from '../games/entities/game.entity.js';
import { PuzzleAttempt } from '../puzzles/entities/puzzle-attempt.entity.js';
import { PuzzleRating } from '../puzzles/entities/puzzle-rating.entity.js';
import { GamesModule } from '../games/games.module.js';
import { UsersModule } from '../users/users.module.js';
import { ProfilesController } from './profiles.controller.js';
import { ProfilesService } from './profiles.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Game, PuzzleRating, PuzzleAttempt]),
    UsersModule,
    GamesModule,
    FriendsModule,
  ],
  controllers: [ProfilesController],
  providers: [ProfilesService],
})
export class ProfilesModule {}

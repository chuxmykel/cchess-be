import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GamesModule } from '../games/games.module.js';
import { UsersModule } from '../users/users.module.js';
import { ChallengesController } from './challenges.controller.js';
import { ChallengesService } from './challenges.service.js';
import { Challenge } from './entities/challenge.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Challenge]), GamesModule, UsersModule],
  controllers: [ChallengesController],
  providers: [ChallengesService],
  exports: [ChallengesService],
})
export class ChallengesModule {}

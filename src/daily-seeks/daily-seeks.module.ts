import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GamesModule } from '../games/games.module.js';
import { UsersModule } from '../users/users.module.js';
import { DailySeeksController } from './daily-seeks.controller.js';
import { DailySeeksService } from './daily-seeks.service.js';
import { DailySeek } from './entities/daily-seek.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([DailySeek]), GamesModule, UsersModule],
  controllers: [DailySeeksController],
  providers: [DailySeeksService],
})
export class DailySeeksModule {}

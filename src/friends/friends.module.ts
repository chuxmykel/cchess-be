import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GamesModule } from '../games/games.module.js';
import { UsersModule } from '../users/users.module.js';
import { Friendship } from './entities/friendship.entity.js';
import { FriendsController } from './friends.controller.js';
import { FriendsService } from './friends.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Friendship]), UsersModule, GamesModule],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}

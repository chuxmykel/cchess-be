import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '../users/users.module.js';
import { Friendship } from './entities/friendship.entity.js';
import { FriendsController } from './friends.controller.js';
import { FriendsService } from './friends.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Friendship]), UsersModule],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}

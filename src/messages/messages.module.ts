import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FriendsModule } from '../friends/friends.module.js';
import { UsersModule } from '../users/users.module.js';
import { Conversation } from './entities/conversation.entity.js';
import { DirectMessage } from './entities/direct-message.entity.js';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([DirectMessage, Conversation]),
    UsersModule,
    FriendsModule,
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}

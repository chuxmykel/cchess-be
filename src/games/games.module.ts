import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '../users/users.module.js';
import { BookmarksService } from './bookmarks.service.js';
import { Bookmark } from './entities/bookmark.entity.js';
import { GameChatMessage } from './entities/game-chat-message.entity.js';
import { Game } from './entities/game.entity.js';
import { Move } from './entities/move.entity.js';
import { GameChatService } from './game-chat.service.js';
import { GamesController } from './games.controller.js';
import { GamesService } from './games.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Game, Move, GameChatMessage, Bookmark]),
    UsersModule,
  ],
  controllers: [GamesController],
  providers: [GamesService, GameChatService, BookmarksService],
  exports: [GamesService, GameChatService],
})
export class GamesModule {}

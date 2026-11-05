import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '../users/users.module.js';
import { BookmarksService } from './bookmarks.service.js';
import { DailyDeadlineSweeper } from './daily-deadline.sweeper.js';
import { Bookmark } from './entities/bookmark.entity.js';
import { ConditionalMovesService } from './conditional-moves.service.js';
import { ConditionalMoveSet } from './entities/conditional-move-set.entity.js';
import { GameChatMessage } from './entities/game-chat-message.entity.js';
import { GameNote } from './entities/game-note.entity.js';
import { GameChatRead } from './entities/game-chat-read.entity.js';
import { Game } from './entities/game.entity.js';
import { Move } from './entities/move.entity.js';
import { GameChatService } from './game-chat.service.js';
import { GameNotesService } from './game-notes.service.js';
import { GamesController } from './games.controller.js';
import { GamesService } from './games.service.js';
import { RematchService } from './rematch.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Game,
      Move,
      GameChatMessage,
      GameChatRead,
      Bookmark,
      GameNote,
      ConditionalMoveSet,
    ]),
    UsersModule,
  ],
  controllers: [GamesController],
  providers: [
    GamesService,
    GameChatService,
    BookmarksService,
    RematchService,
    DailyDeadlineSweeper,
    GameNotesService,
    ConditionalMovesService,
  ],
  exports: [GamesService, GameChatService, RematchService],
})
export class GamesModule {}

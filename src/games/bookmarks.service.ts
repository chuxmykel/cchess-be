import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Bookmark } from './entities/bookmark.entity.js';
import { GamesService } from './games.service.js';

/** Games a user has bookmarked to find again; any game can be bookmarked. */
@Injectable()
export class BookmarksService {
  constructor(
    @InjectRepository(Bookmark)
    private readonly bookmarks: Repository<Bookmark>,
    private readonly gamesService: GamesService,
  ) {}

  isBookmarked(userId: string, gameId: string): Promise<boolean> {
    return this.bookmarks.existsBy({ userId, gameId });
  }

  async bookmark(userId: string, gameId: string): Promise<void> {
    await this.gamesService.getGameOrThrow(gameId);
    await this.bookmarks.upsert({ userId, gameId }, ['userId', 'gameId']);
  }

  async unbookmark(userId: string, gameId: string): Promise<void> {
    await this.bookmarks.delete({ userId, gameId });
  }
}

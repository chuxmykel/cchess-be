import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { GameNote } from './entities/game-note.entity.js';
import { GamesService } from './games.service.js';

export interface GameNoteContent {
  body: string;
  /** Null when there are none. */
  updatedAt: Date | null;
}

/** Each player's own notes on a game, which nobody else sees. */
@Injectable()
export class GameNotesService {
  constructor(
    @InjectRepository(GameNote)
    private readonly notes: Repository<GameNote>,
    private readonly gamesService: GamesService,
  ) {}

  async get(userId: string, gameId: string): Promise<GameNoteContent> {
    const note = await this.notes.findOneBy({ userId, gameId });
    return { body: note?.body ?? '', updatedAt: note?.updatedAt ?? null };
  }

  /** Replaces the notes - or, given none, deletes them. */
  async save(
    userId: string,
    gameId: string,
    body: string,
  ): Promise<GameNoteContent> {
    await this.gamesService.getGameOrThrow(gameId);
    if (body.trim() === '') {
      await this.notes.delete({ userId, gameId });
      return { body: '', updatedAt: null };
    }
    await this.notes.upsert({ userId, gameId, body }, ['userId', 'gameId']);
    return this.get(userId, gameId);
  }
}

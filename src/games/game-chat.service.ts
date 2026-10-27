import { BadRequestException, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DOMAIN_EVENTS } from '../common/events.js';
import { SlidingWindowLimiter } from '../common/sliding-window-limiter.js';
import type { Game } from './entities/game.entity.js';
import {
  GameChatMessage,
  MAX_CHAT_MESSAGE_LENGTH,
} from './entities/game-chat-message.entity.js';
import { GamesService } from './games.service.js';

export const CHAT_RATE_LIMIT = { messages: 5, perMs: 10_000 };

export interface GameChatEvent {
  game: Game;
  message: GameChatMessage;
}

/** In-game chat between a game's two players. */
@Injectable()
export class GameChatService {
  private readonly limiter = new SlidingWindowLimiter(CHAT_RATE_LIMIT);

  constructor(
    @InjectRepository(GameChatMessage)
    private readonly messages: Repository<GameChatMessage>,
    private readonly gamesService: GamesService,
    private readonly events: EventEmitter2,
  ) {}

  async send(
    gameId: string,
    userId: string,
    text: unknown,
  ): Promise<GameChatMessage> {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) throw new BadRequestException('Message is empty');
    if (trimmed.length > MAX_CHAT_MESSAGE_LENGTH) {
      throw new BadRequestException('Message is too long');
    }
    const game = await this.gamesService.getGameOrThrow(gameId);
    this.gamesService.colorOf(game, userId);
    this.limiter.recordOrThrow(`${gameId}:${userId}`);

    const message = await this.messages.save(
      this.messages.create({ gameId, userId, text: trimmed }),
    );
    this.events.emit(DOMAIN_EVENTS.GAME_CHAT_MESSAGE, {
      game,
      message,
    } satisfies GameChatEvent);
    return message;
  }

  async history(gameId: string, userId: string): Promise<GameChatMessage[]> {
    const game = await this.gamesService.getGameOrThrow(gameId);
    this.gamesService.colorOf(game, userId);
    return this.messages.find({
      where: { gameId },
      order: { createdAt: 'ASC' },
    });
  }
}

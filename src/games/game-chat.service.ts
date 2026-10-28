import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DOMAIN_EVENTS } from '../common/events.js';
import { SlidingWindowLimiter } from '../common/sliding-window-limiter.js';
import { isChatOpen } from './chat-window.js';
import type { Game } from './entities/game.entity.js';
import {
  type ChatMessageKind,
  GameChatMessage,
  MAX_CHAT_MESSAGE_LENGTH,
} from './entities/game-chat-message.entity.js';
import { type DrawEvent, GamesService } from './games.service.js';

export const CHAT_RATE_LIMIT = { messages: 5, perMs: 10_000 };

export interface GameChatEvent {
  game: Game;
  message: GameChatMessage;
}

/** In-game chat between a game's two players - with notes of the draws
 * offered, declined and accepted among their messages. */
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
    if (!isChatOpen(game)) throw new ForbiddenException('Chat closed');
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

  @OnEvent(DOMAIN_EVENTS.GAME_DRAW_OFFERED)
  onDrawOffered({ game, byUserId }: DrawEvent) {
    return this.note(game, byUserId, 'draw-offered');
  }

  @OnEvent(DOMAIN_EVENTS.GAME_DRAW_DECLINED)
  onDrawDeclined({ game, byUserId }: DrawEvent) {
    return this.note(game, byUserId, 'draw-declined');
  }

  @OnEvent(DOMAIN_EVENTS.GAME_DRAW_ACCEPTED)
  onDrawAccepted({ game, byUserId }: DrawEvent) {
    return this.note(game, byUserId, 'draw-accepted');
  }

  /** Saves a note in the game's chat and sends it like a message - kept
   * in the history, and past the rate limit, since a player didn't type
   * it. */
  private async note(game: Game, userId: string, kind: ChatMessageKind) {
    const message = await this.messages.save(
      this.messages.create({ gameId: game.id, userId, kind, text: '' }),
    );
    this.events.emit(DOMAIN_EVENTS.GAME_CHAT_MESSAGE, {
      game,
      message,
    } satisfies GameChatEvent);
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

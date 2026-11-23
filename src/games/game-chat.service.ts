import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BlocksService } from '../blocks/blocks.service.js';
import { DOMAIN_EVENTS } from '../common/events.js';
import { Friendship } from '../friends/entities/friendship.entity.js';
import { UsersService } from '../users/users.service.js';
import { maskProfanity } from '../common/profanity.js';
import { SlidingWindowLimiter } from '../common/sliding-window-limiter.js';
import { chatAllowed } from './chat-rules.js';
import { isChatOpen } from './chat-window.js';
import type { Game } from './entities/game.entity.js';
import {
  type ChatMessageKind,
  GameChatMessage,
  MAX_CHAT_MESSAGE_LENGTH,
} from './entities/game-chat-message.entity.js';
import { GameChatRead } from './entities/game-chat-read.entity.js';
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
    @InjectRepository(GameChatRead)
    private readonly reads: Repository<GameChatRead>,
    private readonly gamesService: GamesService,
    private readonly events: EventEmitter2,
    private readonly blocksService: BlocksService,
    @InjectRepository(Friendship)
    private readonly friendships: Repository<Friendship>,
    private readonly usersService: UsersService,
  ) {}

  /** Whether the game's two players can chat (see chat-rules.ts). */
  async isEnabled(game: Game): Promise<boolean> {
    const [white, black, friends, blocked] = await Promise.all([
      this.usersService.findByIdOrThrow(game.whiteId),
      this.usersService.findByIdOrThrow(game.blackId),
      this.friendships.existsBy([
        {
          requesterId: game.whiteId,
          addresseeId: game.blackId,
          status: 'accepted',
        },
        {
          requesterId: game.blackId,
          addresseeId: game.whiteId,
          status: 'accepted',
        },
      ]),
      this.blocksService.isBlockedEitherWay(game.whiteId, game.blackId),
    ]);
    return chatAllowed(white, black, { friends, blocked });
  }

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
    if (!(await this.isEnabled(game))) {
      throw new ForbiddenException('Chat is off for this game');
    }
    this.limiter.recordOrThrow(`${gameId}:${userId}`);

    const message = await this.messages.save(
      this.messages.create({ gameId, userId, text: maskProfanity(trimmed) }),
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

  /** The game's chat, with how far this player has read it - null when
   * they never have. */
  async history(
    gameId: string,
    userId: string,
  ): Promise<{
    messages: GameChatMessage[];
    readAt: Date | null;
    enabled: boolean;
  }> {
    const game = await this.gamesService.getGameOrThrow(gameId);
    this.gamesService.colorOf(game, userId);
    const [messages, read, enabled] = await Promise.all([
      this.messages.find({ where: { gameId }, order: { createdAt: 'ASC' } }),
      this.reads.findOne({ where: { gameId, userId } }),
      this.isEnabled(game),
    ]);
    return { messages, readAt: read?.readAt ?? null, enabled };
  }

  /** Marks the chat read up to now: the player has seen all of it. */
  async markRead(gameId: string, userId: string): Promise<Date> {
    const game = await this.gamesService.getGameOrThrow(gameId);
    this.gamesService.colorOf(game, userId);
    const readAt = new Date();
    await this.reads.upsert({ gameId, userId, readAt }, ['gameId', 'userId']);
    return readAt;
  }
}

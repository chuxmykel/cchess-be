import { randomUUID } from 'node:crypto';

import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';

import { EmailToken } from '../auth/entities/email-token.entity.js';
import { RefreshToken } from '../auth/entities/refresh-token.entity.js';
import { Challenge } from '../challenges/entities/challenge.entity.js';
import { DOMAIN_EVENTS } from '../common/events.js';
import { DailySeek } from '../daily-seeks/entities/daily-seek.entity.js';
import { Friendship } from '../friends/entities/friendship.entity.js';
import { Bookmark } from '../games/entities/bookmark.entity.js';
import { ConditionalMoveSet } from '../games/entities/conditional-move-set.entity.js';
import { GameChatMessage } from '../games/entities/game-chat-message.entity.js';
import { GameChatRead } from '../games/entities/game-chat-read.entity.js';
import { GameNote } from '../games/entities/game-note.entity.js';
import { GameReview } from '../games/entities/game-review.entity.js';
import { Game } from '../games/entities/game.entity.js';
import { GamesService } from '../games/games.service.js';
import { MatchmakingService } from '../matchmaking/matchmaking.service.js';
import { Conversation } from '../messages/entities/conversation.entity.js';
import { DirectMessage } from '../messages/entities/direct-message.entity.js';
import { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';

/** What a deleted account is shown as, in its opponents' games. */
export const DELETED_PLAYER_NAME = 'Deleted player';

/**
 * Deletes an account, as both stores require: everything personal goes -
 * really goes, not soft-deleted, the one place this app hard-deletes -
 * while the user row stays, anonymised, so the games it played keep a
 * player for their opponents' history and ratings.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly gamesService: GamesService,
    private readonly matchmaking: MatchmakingService,
    private readonly events: EventEmitter2,
  ) {}

  async deleteAccount(userId: string, password?: string): Promise<void> {
    const user = await this.usersService.findActiveById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.isGuest) {
      const matches =
        !!password &&
        !!user.passwordHash &&
        (await bcrypt.compare(password, user.passwordHash));
      if (!matches) throw new UnauthorizedException('Wrong password');
    }

    this.matchmaking.cancelSeek(userId);
    await this.endGamesInProgress(userId);

    await this.dataSource.transaction(async (manager) => {
      const mine = { userId };
      await manager.delete(DirectMessage, [
        { senderId: userId },
        { recipientId: userId },
      ]);
      await manager.delete(Conversation, [
        { ownerId: userId },
        { otherUserId: userId },
      ]);
      await manager.delete(GameChatMessage, mine);
      await manager.delete(GameChatRead, mine);
      await manager.delete(GameNote, mine);
      await manager.delete(ConditionalMoveSet, mine);
      await manager.delete(Bookmark, mine);
      await manager.delete(DailySeek, mine);
      await manager.delete(Friendship, [
        { requesterId: userId },
        { addresseeId: userId },
      ]);
      await manager.delete(Challenge, [
        { challengerId: userId },
        { opponentId: userId },
      ]);
      await manager.delete(RefreshToken, mine);
      await manager.delete(EmailToken, mine);
      await manager.update(
        GameReview,
        { createdById: userId },
        { createdById: null },
      );
      await manager.update(
        User,
        { id: userId },
        {
          username: `deleted_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
          displayName: DELETED_PLAYER_NAME,
          email: null,
          emailVerifiedAt: null,
          passwordHash: null,
          bio: null,
          lastSeenAt: null,
          accountDeletedAt: new Date(),
        },
      );
    });
    this.events.emit(DOMAIN_EVENTS.USER_DELETED, { userId });
  }

  /** Every game still being played, live or daily, ended as the player
   * would end it: aborted while it can be, resigned after. */
  private async endGamesInProgress(userId: string): Promise<void> {
    const games = await this.dataSource.getRepository(Game).find({
      select: { id: true },
      where: [
        { whiteId: userId, status: 'active' },
        { blackId: userId, status: 'active' },
      ],
    });
    for (const { id } of games) {
      try {
        await this.gamesService.abort(id, userId);
      } catch {
        try {
          await this.gamesService.resign(id, userId);
        } catch (error) {
          this.logger.error(
            `could not end game ${id} for a deleted account: ${(error as Error).message}`,
          );
        }
      }
    }
  }
}

import { randomUUID } from 'node:crypto';

import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import { DataSource, EntityTarget, IsNull, ObjectLiteral } from 'typeorm';

import { EmailToken } from '../auth/entities/email-token.entity.js';
import { UserBlock } from '../blocks/entities/user-block.entity.js';
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
import { Report } from '../reports/entities/report.entity.js';
import { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';

/** What a deleted account is shown as, in its opponents' games. */
export const DELETED_PLAYER_NAME = 'Deleted player';

/**
 * Deletes an account, as both stores require: everything personal is
 * soft-deleted, gone from the app at once (a purge erases it for good
 * later), while the user row stays, anonymised, so the games it played
 * keep a player for their opponents' history and ratings.
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
      // Soft-deleted, as everything is: gone from the app at once, and
      // erased for good by the purge that follows deleted accounts.
      const erase: Array<[EntityTarget<ObjectLiteral>, ObjectLiteral]> = [
        [DirectMessage, { senderId: userId }],
        [DirectMessage, { recipientId: userId }],
        [Conversation, { ownerId: userId }],
        [Conversation, { otherUserId: userId }],
        [GameChatMessage, { userId }],
        [GameChatRead, { userId }],
        [GameNote, { userId }],
        [ConditionalMoveSet, { userId }],
        [Bookmark, { userId }],
        [DailySeek, { userId }],
        [Friendship, { requesterId: userId }],
        [Friendship, { addresseeId: userId }],
        [Challenge, { challengerId: userId }],
        [Challenge, { opponentId: userId }],
        [UserBlock, { blockerId: userId }],
        [UserBlock, { blockedId: userId }],
        [Report, { reporterId: userId }],
        [Report, { reportedUserId: userId }],
        [RefreshToken, { userId }],
        [EmailToken, { userId }],
      ];
      for (const [entity, where] of erase) {
        await manager.softDelete(entity, { ...where, deletedAt: IsNull() });
      }
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

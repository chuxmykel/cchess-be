import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';

import { DOMAIN_EVENTS } from '../common/events.js';
import { SlidingWindowLimiter } from '../common/sliding-window-limiter.js';
import { FriendsService } from '../friends/friends.service.js';
import { Game } from '../games/entities/game.entity.js';
import type { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import {
  AttachmentError,
  type MessageAttachment,
  parseAttachment,
} from './attachment.js';
import {
  type ConversationDto,
  DEFAULT_CONVERSATIONS_PAGE,
  DEFAULT_MESSAGES_PAGE,
  MAX_CONVERSATIONS_PAGE,
  MAX_MESSAGES_PAGE,
} from './dto/direct-message.dto.js';
import { Conversation } from './entities/conversation.entity.js';
import {
  DirectMessage,
  MAX_DIRECT_MESSAGE_LENGTH,
} from './entities/direct-message.entity.js';

export const DIRECT_MESSAGE_RATE_LIMIT = { messages: 10, perMs: 10_000 };

export interface DirectMessageEvent {
  message: DirectMessage;
}

/** `readerId` has read their messages with `otherUserId`, up to `readAt`. */
export interface DirectMessagesReadEvent {
  readerId: string;
  otherUserId: string;
  readAt: Date;
}

interface ConversationRow {
  id: string;
  senderId: string;
  recipientId: string;
  text: string;
  attachment: MessageAttachment | null;
  createdAt: Date;
  otherId: string;
  username: string;
  displayName: string;
  avatarColor: string;
  unreadCount: string;
  theirLastReadAt: Date | null;
}

/** Private messages between friends. */
@Injectable()
export class MessagesService {
  private readonly limiter = new SlidingWindowLimiter(
    DIRECT_MESSAGE_RATE_LIMIT,
  );

  constructor(
    @InjectRepository(DirectMessage)
    private readonly messages: Repository<DirectMessage>,
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectRepository(Game) private readonly games: Repository<Game>,
    private readonly usersService: UsersService,
    private readonly friendsService: FriendsService,
    private readonly events: EventEmitter2,
  ) {}

  /** Sends `text` - which may be empty with an attachment, a game or
   * position to share. */
  async send(
    senderId: string,
    recipientUsername: string,
    text: string | undefined,
    rawAttachment?: unknown,
  ): Promise<DirectMessage> {
    const trimmed = (text ?? '').trim();
    const attachment =
      rawAttachment === undefined || rawAttachment === null
        ? null
        : await this.checkedAttachment(rawAttachment);
    if (!trimmed && !attachment) {
      throw new BadRequestException('Message is empty');
    }
    if (trimmed.length > MAX_DIRECT_MESSAGE_LENGTH) {
      throw new BadRequestException('Message is too long');
    }
    const recipient = await this.findOtherUser(senderId, recipientUsername);
    if (!(await this.friendsService.areFriends(senderId, recipient.id))) {
      throw new ForbiddenException('You can only message friends');
    }
    this.limiter.recordOrThrow(senderId);

    const message = await this.messages.save(
      this.messages.create({
        senderId,
        recipientId: recipient.id,
        text: trimmed,
        attachment,
      }),
    );
    this.events.emit(DOMAIN_EVENTS.DIRECT_MESSAGE_SENT, {
      message,
    } satisfies DirectMessageEvent);
    return message;
  }

  private async checkedAttachment(raw: unknown): Promise<MessageAttachment> {
    let attachment: MessageAttachment;
    try {
      attachment = parseAttachment(raw);
    } catch (error) {
      if (error instanceof AttachmentError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    if (
      attachment.kind === 'game' &&
      !(await this.games.exists({ where: { id: attachment.gameId } }))
    ) {
      throw new NotFoundException('Game not found');
    }
    return attachment;
  }

  /** The newest messages first, from after the owner last cleared them. */
  async history(
    ownerId: string,
    otherUsername: string,
    options: { limit?: number; before?: Date } = {},
  ): Promise<DirectMessage[]> {
    const other = await this.findOtherUser(ownerId, otherUsername);
    const conversation = await this.conversations.findOneBy({
      ownerId,
      otherUserId: other.id,
    });
    const qb = this.messages
      .createQueryBuilder('m')
      .where(
        new Brackets((pair) =>
          pair
            .where('m.senderId = :ownerId AND m.recipientId = :otherId')
            .orWhere('m.senderId = :otherId AND m.recipientId = :ownerId'),
        ),
        { ownerId, otherId: other.id },
      )
      .orderBy('m.createdAt', 'DESC')
      .take(
        Math.min(options.limit ?? DEFAULT_MESSAGES_PAGE, MAX_MESSAGES_PAGE),
      );
    if (conversation?.clearedAt) {
      qb.andWhere('m.createdAt > :clearedAt', {
        clearedAt: conversation.clearedAt,
      });
    }
    if (options.before) {
      qb.andWhere('m.createdAt < :before', { before: options.before });
    }
    return qb.getMany();
  }

  /**
   * The owner's conversations, the one with the newest message first: for
   * each person they've messages with since they last cleared them, that
   * person, the newest message, how many of theirs are unread, and when
   * they last read the owner's - for an inbox. A page of `limit`, of those
   * whose newest message is older than `before`.
   */
  async conversationsOf(
    ownerId: string,
    options: { limit?: number; before?: Date } = {},
  ): Promise<ConversationDto[]> {
    const limit = Math.min(
      options.limit ?? DEFAULT_CONVERSATIONS_PAGE,
      MAX_CONVERSATIONS_PAGE,
    );
    const rows: ConversationRow[] = await this.messages.query(
      `WITH visible AS (
         SELECT m.*,
           CASE WHEN m."senderId" = $1 THEN m."recipientId"
                ELSE m."senderId" END AS "otherId"
         FROM direct_messages m
         LEFT JOIN conversations c
           ON c."ownerId" = $1
          AND c."otherUserId" = CASE WHEN m."senderId" = $1
                                     THEN m."recipientId"
                                     ELSE m."senderId" END
         WHERE ($1 IN (m."senderId", m."recipientId"))
           AND m."deletedAt" IS NULL
           AND m."createdAt" > COALESCE(c."clearedAt", '-infinity')
       ),
       latest AS (
         SELECT DISTINCT ON ("otherId") *
         FROM visible
         ORDER BY "otherId", "createdAt" DESC, id DESC
       )
       SELECT latest.id, latest."senderId", latest."recipientId", latest.text,
         latest.attachment, latest."createdAt", latest."otherId",
         u.username, u."displayName", u."avatarColor",
         (SELECT COUNT(*) FROM visible v
           WHERE v."senderId" = latest."otherId"
             AND v."createdAt" > COALESCE(mine."lastReadAt", '-infinity'))
           AS "unreadCount",
         theirs."lastReadAt" AS "theirLastReadAt"
       FROM latest
       JOIN users u ON u.id = latest."otherId" AND u."deletedAt" IS NULL
       LEFT JOIN conversations mine
         ON mine."ownerId" = $1 AND mine."otherUserId" = latest."otherId"
       LEFT JOIN conversations theirs
         ON theirs."ownerId" = latest."otherId" AND theirs."otherUserId" = $1
       WHERE $2::timestamptz IS NULL OR latest."createdAt" < $2
       ORDER BY latest."createdAt" DESC, latest.id DESC
       LIMIT $3`,
      [ownerId, options.before ?? null, limit],
    );
    return rows.map((row) => ({
      user: {
        id: row.otherId,
        username: row.username,
        displayName: row.displayName,
        avatarColor: row.avatarColor,
      },
      lastMessage: {
        id: row.id,
        senderId: row.senderId,
        recipientId: row.recipientId,
        text: row.text,
        attachment: row.attachment,
        createdAt: row.createdAt,
      },
      unreadCount: Number(row.unreadCount),
      theirLastReadAt: row.theirLastReadAt,
    }));
  }

  /** When the other person last read the owner's messages - for "Seen". */
  async theirLastReadAt(
    ownerId: string,
    otherUsername: string,
  ): Promise<Date | null> {
    const other = await this.findOtherUser(ownerId, otherUsername);
    const theirs = await this.conversations.findOneBy({
      ownerId: other.id,
      otherUserId: ownerId,
    });
    return theirs?.lastReadAt ?? null;
  }

  async markRead(ownerId: string, otherUsername: string): Promise<void> {
    const other = await this.findOtherUser(ownerId, otherUsername);
    const readAt = new Date();
    await this.conversations.upsert(
      { ownerId, otherUserId: other.id, lastReadAt: readAt },
      ['ownerId', 'otherUserId'],
    );
    this.emitRead(ownerId, other.id, readAt);
  }

  /** Hides the messages so far from the owner only - read, too. */
  async clear(ownerId: string, otherUsername: string): Promise<void> {
    const other = await this.findOtherUser(ownerId, otherUsername);
    const now = new Date();
    await this.conversations.upsert(
      { ownerId, otherUserId: other.id, lastReadAt: now, clearedAt: now },
      ['ownerId', 'otherUserId'],
    );
    this.emitRead(ownerId, other.id, now);
  }

  private emitRead(readerId: string, otherUserId: string, readAt: Date) {
    this.events.emit(DOMAIN_EVENTS.DIRECT_MESSAGES_READ, {
      readerId,
      otherUserId,
      readAt,
    } satisfies DirectMessagesReadEvent);
  }

  /** How many messages each sender has sent the owner since they last
   * read or cleared their conversation. */
  async unreadCounts(
    ownerId: string,
  ): Promise<{ userId: string; count: number }[]> {
    const rows = await this.messages
      .createQueryBuilder('m')
      .select('m.senderId', 'userId')
      .addSelect('COUNT(*)', 'count')
      .leftJoin(
        Conversation,
        'c',
        'c.ownerId = m.recipientId AND c.otherUserId = m.senderId',
      )
      .where('m.recipientId = :ownerId', { ownerId })
      .andWhere(
        `m.createdAt > GREATEST(COALESCE(c.lastReadAt, '-infinity'), COALESCE(c.clearedAt, '-infinity'))`,
      )
      .groupBy('m.senderId')
      .getRawMany<{ userId: string; count: string }>();
    return rows.map((row) => ({
      userId: row.userId,
      count: Number(row.count),
    }));
  }

  private async findOtherUser(
    ownerId: string,
    username: string,
  ): Promise<User> {
    const user = await this.usersService.findByUsername(username);
    if (!user) throw new NotFoundException('User not found');
    if (user.id === ownerId) {
      throw new BadRequestException("You can't message yourself");
    }
    return user;
  }
}

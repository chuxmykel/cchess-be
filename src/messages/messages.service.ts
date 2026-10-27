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
import type { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import {
  DEFAULT_MESSAGES_PAGE,
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
    private readonly usersService: UsersService,
    private readonly friendsService: FriendsService,
    private readonly events: EventEmitter2,
  ) {}

  async send(
    senderId: string,
    recipientUsername: string,
    text: string,
  ): Promise<DirectMessage> {
    const trimmed = text.trim();
    if (!trimmed) throw new BadRequestException('Message is empty');
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
      }),
    );
    this.events.emit(DOMAIN_EVENTS.DIRECT_MESSAGE_SENT, {
      message,
    } satisfies DirectMessageEvent);
    return message;
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

  async markRead(ownerId: string, otherUsername: string): Promise<void> {
    const other = await this.findOtherUser(ownerId, otherUsername);
    await this.conversations.upsert(
      { ownerId, otherUserId: other.id, lastReadAt: new Date() },
      ['ownerId', 'otherUserId'],
    );
  }

  /** Hides the messages so far from the owner only. */
  async clear(ownerId: string, otherUsername: string): Promise<void> {
    const other = await this.findOtherUser(ownerId, otherUsername);
    const now = new Date();
    await this.conversations.upsert(
      { ownerId, otherUserId: other.id, lastReadAt: now, clearedAt: now },
      ['ownerId', 'otherUserId'],
    );
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

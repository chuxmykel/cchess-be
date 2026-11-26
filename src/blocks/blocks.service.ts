import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DOMAIN_EVENTS } from '../common/events.js';
import { UsersService } from '../users/users.service.js';
import { UserBlock } from './entities/user-block.entity.js';

export interface UserBlockedEvent {
  blockerId: string;
  blockedId: string;
}

/** Who has blocked whom. A block works both ways: whichever player made
 * it, the two can't friend, challenge, chat with or be paired against each
 * other. Blocking also ends a friendship and cancels requests and
 * challenges between them - by `user.blocked`, which their services hear. */
@Injectable()
export class BlocksService {
  constructor(
    @InjectRepository(UserBlock)
    private readonly blocks: Repository<UserBlock>,
    private readonly usersService: UsersService,
    private readonly events: EventEmitter2,
  ) {}

  async block(blockerId: string, username: string): Promise<void> {
    const target = await this.usersService.findByUsername(username);
    if (!target || target.accountDeletedAt) {
      throw new NotFoundException('User not found');
    }
    if (target.id === blockerId) {
      throw new BadRequestException("You can't block yourself");
    }
    await this.blocks.upsert(
      { blockerId, blockedId: target.id, deletedAt: null },
      ['blockerId', 'blockedId'],
    );
    // Awaited, so the friendship and challenges are gone by the reply.
    await this.events.emitAsync(DOMAIN_EVENTS.USER_BLOCKED, {
      blockerId,
      blockedId: target.id,
    } satisfies UserBlockedEvent);
  }

  async unblock(blockerId: string, username: string): Promise<void> {
    const target = await this.usersService.findByUsername(username);
    if (!target) throw new NotFoundException('User not found');
    await this.blocks.softDelete({ blockerId, blockedId: target.id });
  }

  /** The players you've blocked, the latest first. */
  list(blockerId: string): Promise<UserBlock[]> {
    return this.blocks.find({
      where: { blockerId },
      relations: { blocked: true },
      order: { createdAt: 'DESC' },
    });
  }

  hasBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    return this.blocks.existsBy({ blockerId, blockedId });
  }

  /** Whether either player has blocked the other. */
  isBlockedEitherWay(userAId: string, userBId: string): Promise<boolean> {
    return this.blocks.existsBy([
      { blockerId: userAId, blockedId: userBId },
      { blockerId: userBId, blockedId: userAId },
    ]);
  }

  /** Everyone a player has blocked or been blocked by - for pairing. */
  async blockedEitherWay(userId: string): Promise<Set<string>> {
    const rows = await this.blocks.find({
      select: { blockerId: true, blockedId: true },
      where: [{ blockerId: userId }, { blockedId: userId }],
    });
    return new Set(
      rows.map((row) =>
        row.blockerId === userId ? row.blockedId : row.blockerId,
      ),
    );
  }
}

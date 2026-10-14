import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DOMAIN_EVENTS } from '../common/events.js';
import { UsersService } from '../users/users.service.js';
import { Friendship } from './entities/friendship.entity.js';

export interface FriendRequestEvent {
  friendship: Friendship;
}

@Injectable()
export class FriendsService {
  constructor(
    @InjectRepository(Friendship)
    private readonly friendships: Repository<Friendship>,
    private readonly usersService: UsersService,
    private readonly events: EventEmitter2,
  ) {}

  private async findBetween(
    userAId: string,
    userBId: string,
  ): Promise<Friendship | null> {
    return this.friendships
      .createQueryBuilder('f')
      .where(
        '(f.requesterId = :a AND f.addresseeId = :b) OR (f.requesterId = :b AND f.addresseeId = :a)',
        { a: userAId, b: userBId },
      )
      .andWhere('f.deletedAt IS NULL')
      .getOne();
  }

  async sendRequest(
    requesterId: string,
    targetUsername: string,
  ): Promise<Friendship> {
    const target = await this.usersService.findByUsername(targetUsername);
    if (!target) throw new NotFoundException('User not found');
    if (target.id === requesterId) {
      throw new BadRequestException("You can't friend yourself");
    }

    const existing = await this.findBetween(requesterId, target.id);
    if (existing?.status === 'accepted') {
      throw new ConflictException('Already friends');
    }
    if (
      existing?.status === 'pending' &&
      existing.requesterId === requesterId
    ) {
      throw new ConflictException('Friend request already sent');
    }
    if (existing?.status === 'pending' && existing.requesterId === target.id) {
      // They already asked us - accepting is the more useful outcome than a
      // second pending row that just mirrors the first.
      existing.status = 'accepted';
      existing.respondedAt = new Date();
      const saved = await this.friendships.save(existing);
      this.events.emit(DOMAIN_EVENTS.FRIEND_REQUEST_ACCEPTED, {
        friendship: saved,
      } satisfies FriendRequestEvent);
      return saved;
    }
    if (existing?.status === 'declined') {
      existing.requesterId = requesterId;
      existing.addresseeId = target.id;
      existing.status = 'pending';
      existing.respondedAt = null;
      const saved = await this.friendships.save(existing);
      this.events.emit(DOMAIN_EVENTS.FRIEND_REQUEST_CREATED, {
        friendship: saved,
      } satisfies FriendRequestEvent);
      return saved;
    }

    const saved = await this.friendships.save(
      this.friendships.create({
        requesterId,
        addresseeId: target.id,
        status: 'pending',
      }),
    );
    this.events.emit(DOMAIN_EVENTS.FRIEND_REQUEST_CREATED, {
      friendship: saved,
    } satisfies FriendRequestEvent);
    return saved;
  }

  async respond(
    userId: string,
    requestId: string,
    accept: boolean,
  ): Promise<Friendship> {
    const request = await this.friendships.findOne({
      where: { id: requestId },
    });
    if (!request || request.addresseeId !== userId) {
      throw new NotFoundException('Friend request not found');
    }
    if (request.status !== 'pending') {
      throw new ConflictException('Friend request already resolved');
    }
    request.status = accept ? 'accepted' : 'declined';
    request.respondedAt = new Date();
    const saved = await this.friendships.save(request);
    if (accept)
      this.events.emit(DOMAIN_EVENTS.FRIEND_REQUEST_ACCEPTED, {
        friendship: saved,
      } satisfies FriendRequestEvent);
    return saved;
  }

  async cancelOutgoing(userId: string, requestId: string): Promise<void> {
    const request = await this.friendships.findOne({
      where: { id: requestId },
    });
    if (
      !request ||
      request.requesterId !== userId ||
      request.status !== 'pending'
    ) {
      throw new NotFoundException('Friend request not found');
    }
    await this.friendships.softRemove(request);
  }

  async removeFriend(userId: string, friendUsername: string): Promise<void> {
    const friend = await this.usersService.findByUsername(friendUsername);
    if (!friend) throw new NotFoundException('User not found');
    const existing = await this.findBetween(userId, friend.id);
    if (!existing || existing.status !== 'accepted') {
      throw new NotFoundException('Not friends with this user');
    }
    await this.friendships.softRemove(existing);
  }

  async listFriends(userId: string) {
    const rows = await this.friendships.find({
      where: [
        { requesterId: userId, status: 'accepted' },
        { addresseeId: userId, status: 'accepted' },
      ],
      relations: { requester: true, addressee: true },
    });
    return rows.map((row) =>
      row.requesterId === userId ? row.addressee : row.requester,
    );
  }

  async listIncomingRequests(userId: string): Promise<Friendship[]> {
    return this.friendships.find({
      where: { addresseeId: userId, status: 'pending' },
      relations: { requester: true },
      order: { createdAt: 'DESC' },
    });
  }

  async listOutgoingRequests(userId: string): Promise<Friendship[]> {
    return this.friendships.find({
      where: { requesterId: userId, status: 'pending' },
      relations: { addressee: true },
      order: { createdAt: 'DESC' },
    });
  }
}

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { isValidTimeControl, type TimeControl } from '../chess/time-control.js';
import { Game } from '../games/entities/game.entity.js';
import { GamesService } from '../games/games.service.js';
import { UsersService } from '../users/users.service.js';
import type { User } from '../users/entities/user.entity.js';
import { Challenge, type ColorPreference } from './entities/challenge.entity.js';

const RELATIONS = { challenger: true, opponent: true } as const;

export interface ChallengeCreatedEvent {
  challenge: Challenge;
}
export interface ChallengeAcceptedEvent {
  challenge: Challenge;
  game: Game;
}
export interface ChallengeResolvedEvent {
  challenge: Challenge;
}

@Injectable()
export class ChallengesService {
  constructor(
    @InjectRepository(Challenge) private readonly challenges: Repository<Challenge>,
    private readonly usersService: UsersService,
    private readonly gamesService: GamesService,
    private readonly events: EventEmitter2,
  ) {}

  async create(
    challenger: User,
    opponentUsername: string,
    tc: TimeControl,
    color: ColorPreference = 'random',
  ): Promise<Challenge> {
    if (!isValidTimeControl(tc)) throw new BadRequestException('Invalid time control');

    const opponent = await this.usersService.findByUsername(opponentUsername);
    if (!opponent) throw new NotFoundException('User not found');
    if (opponent.id === challenger.id) throw new BadRequestException("You can't challenge yourself");

    const challenge = await this.challenges.save(
      this.challenges.create({
        challenger,
        challengerId: challenger.id,
        opponent,
        opponentId: opponent.id,
        minutes: tc.minutes,
        incrementSeconds: tc.incrementSeconds,
        challengerColor: color,
        status: 'pending',
        gameId: null,
      }),
    );

    this.events.emit('challenge.created', { challenge } satisfies ChallengeCreatedEvent);
    return challenge;
  }

  async accept(userId: string, challengeId: string): Promise<{ challenge: Challenge; game: Game }> {
    const challenge = await this.getOrThrow(challengeId);
    if (challenge.opponentId !== userId) throw new ForbiddenException('Not your challenge to accept');
    if (challenge.status !== 'pending') throw new ConflictException('Challenge already resolved');

    const challengerWhite =
      challenge.challengerColor === 'random' ? Math.random() < 0.5 : challenge.challengerColor === 'white';

    const white = challengerWhite ? challenge.challenger : challenge.opponent;
    const black = challengerWhite ? challenge.opponent : challenge.challenger;

    const game = await this.gamesService.createGame(
      white,
      black,
      { minutes: challenge.minutes, incrementSeconds: challenge.incrementSeconds },
      true,
    );

    challenge.status = 'accepted';
    challenge.gameId = game.id;
    challenge.respondedAt = new Date();
    await this.challenges.save(challenge);

    this.events.emit('challenge.accepted', { challenge, game } satisfies ChallengeAcceptedEvent);
    return { challenge, game };
  }

  async decline(userId: string, challengeId: string): Promise<Challenge> {
    const challenge = await this.getOrThrow(challengeId);
    if (challenge.opponentId !== userId) throw new ForbiddenException('Not your challenge to decline');
    if (challenge.status !== 'pending') throw new ConflictException('Challenge already resolved');

    challenge.status = 'declined';
    challenge.respondedAt = new Date();
    await this.challenges.save(challenge);
    this.events.emit('challenge.declined', { challenge } satisfies ChallengeResolvedEvent);
    return challenge;
  }

  async cancel(userId: string, challengeId: string): Promise<Challenge> {
    const challenge = await this.getOrThrow(challengeId);
    if (challenge.challengerId !== userId) throw new ForbiddenException('Not your challenge to cancel');
    if (challenge.status !== 'pending') throw new ConflictException('Challenge already resolved');

    challenge.status = 'cancelled';
    challenge.respondedAt = new Date();
    await this.challenges.save(challenge);
    this.events.emit('challenge.cancelled', { challenge } satisfies ChallengeResolvedEvent);
    return challenge;
  }

  async listIncoming(userId: string): Promise<Challenge[]> {
    return this.challenges.find({
      where: { opponentId: userId, status: 'pending' },
      relations: RELATIONS,
      order: { createdAt: 'DESC' },
    });
  }

  async listOutgoing(userId: string): Promise<Challenge[]> {
    return this.challenges.find({
      where: { challengerId: userId, status: 'pending' },
      relations: RELATIONS,
      order: { createdAt: 'DESC' },
    });
  }

  private async getOrThrow(id: string): Promise<Challenge> {
    const challenge = await this.challenges.findOne({ where: { id }, relations: RELATIONS });
    if (!challenge) throw new NotFoundException('Challenge not found');
    return challenge;
  }
}

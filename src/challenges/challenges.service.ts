import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';

import { isValidTimeControl, type TimeControl } from '../chess/time-control.js';
import { DOMAIN_EVENTS } from '../common/events.js';
import { Game } from '../games/entities/game.entity.js';
import { GamesService } from '../games/games.service.js';
import { UsersService } from '../users/users.service.js';
import type { User } from '../users/entities/user.entity.js';
import {
  Challenge,
  type ChallengeStatus,
  type ColorPreference,
} from './entities/challenge.entity.js';
import { challengeTtlMs, isChallengeExpired } from './challenge-expiry.js';

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

export interface ChallengeOptions {
  color?: ColorPreference;
  rated?: boolean;
}

@Injectable()
export class ChallengesService implements OnModuleDestroy {
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectRepository(Challenge)
    private readonly challenges: Repository<Challenge>,
    private readonly usersService: UsersService,
    private readonly gamesService: GamesService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleDestroy(): void {
    for (const timer of this.expiryTimers.values()) clearTimeout(timer);
  }

  async create(
    challenger: User,
    opponentUsername: string,
    tc: TimeControl,
    { color = 'random', rated = true }: ChallengeOptions = {},
  ): Promise<Challenge> {
    if (!isValidTimeControl(tc))
      throw new BadRequestException('Invalid time control');

    const opponent = await this.usersService.findByUsername(opponentUsername);
    if (!opponent) throw new NotFoundException('User not found');
    if (opponent.id === challenger.id)
      throw new BadRequestException("You can't challenge yourself");
    await this.gamesService.assertNotPlaying(challenger.id);

    await this.cancelPendingBetween(challenger.id, opponent.id);

    const challenge = await this.challenges.save(
      this.challenges.create({
        challenger,
        challengerId: challenger.id,
        opponent,
        opponentId: opponent.id,
        initialSeconds: tc.initialSeconds,
        incrementSeconds: tc.incrementSeconds,
        challengerColor: color,
        rated,
        status: 'pending',
        gameId: null,
      }),
    );

    this.scheduleExpiry(challenge.id);
    this.events.emit(DOMAIN_EVENTS.CHALLENGE_CREATED, {
      challenge,
    } satisfies ChallengeCreatedEvent);
    return challenge;
  }

  private async cancelPendingBetween(
    challengerId: string,
    opponentId: string,
  ): Promise<void> {
    const pending = await this.challenges.find({
      where: { challengerId, opponentId, status: 'pending' },
      relations: RELATIONS,
    });
    for (const challenge of pending) {
      await this.resolve(
        challenge,
        'cancelled',
        DOMAIN_EVENTS.CHALLENGE_CANCELLED,
      );
    }
  }

  private scheduleExpiry(challengeId: string): void {
    const timer = setTimeout(() => {
      this.expiryTimers.delete(challengeId);
      void this.expireIfPending(challengeId);
    }, challengeTtlMs());
    timer.unref?.();
    this.expiryTimers.set(challengeId, timer);
  }

  private async expireIfPending(challengeId: string): Promise<void> {
    const challenge = await this.challenges.findOne({
      where: { id: challengeId },
      relations: RELATIONS,
    });
    if (challenge?.status === 'pending') {
      await this.resolve(challenge, 'expired', DOMAIN_EVENTS.CHALLENGE_EXPIRED);
    }
  }

  private async resolve(
    challenge: Challenge,
    status: Exclude<ChallengeStatus, 'pending' | 'accepted'>,
    event: string,
  ): Promise<Challenge> {
    const timer = this.expiryTimers.get(challenge.id);
    if (timer) clearTimeout(timer);
    this.expiryTimers.delete(challenge.id);
    challenge.status = status;
    challenge.respondedAt = new Date();
    await this.challenges.save(challenge);
    this.events.emit(event, { challenge } satisfies ChallengeResolvedEvent);
    return challenge;
  }

  /** Throws unless the challenge is still waiting for an answer. */
  private async assertPending(challenge: Challenge): Promise<void> {
    if (challenge.status !== 'pending')
      throw new ConflictException('Challenge already resolved');
    if (isChallengeExpired(challenge)) {
      await this.resolve(challenge, 'expired', DOMAIN_EVENTS.CHALLENGE_EXPIRED);
      throw new GoneException('Challenge expired');
    }
  }

  async accept(
    userId: string,
    challengeId: string,
  ): Promise<{ challenge: Challenge; game: Game }> {
    const challenge = await this.getOrThrow(challengeId);
    if (challenge.opponentId !== userId)
      throw new ForbiddenException('Not your challenge to accept');
    await this.assertPending(challenge);
    await this.gamesService.assertNotPlaying(userId);
    await this.gamesService.assertNotPlaying(
      challenge.challengerId,
      `${challenge.challenger.displayName} is in the middle of a game`,
    );

    const challengerWhite =
      challenge.challengerColor === 'random'
        ? Math.random() < 0.5
        : challenge.challengerColor === 'white';

    const white = challengerWhite ? challenge.challenger : challenge.opponent;
    const black = challengerWhite ? challenge.opponent : challenge.challenger;

    const game = await this.gamesService.createGame(
      white,
      black,
      {
        initialSeconds: challenge.initialSeconds,
        incrementSeconds: challenge.incrementSeconds,
      },
      challenge.rated,
    );

    const timer = this.expiryTimers.get(challenge.id);
    if (timer) clearTimeout(timer);
    this.expiryTimers.delete(challenge.id);
    challenge.status = 'accepted';
    challenge.gameId = game.id;
    challenge.respondedAt = new Date();
    await this.challenges.save(challenge);

    this.events.emit(DOMAIN_EVENTS.CHALLENGE_ACCEPTED, {
      challenge,
      game,
    } satisfies ChallengeAcceptedEvent);
    return { challenge, game };
  }

  async decline(userId: string, challengeId: string): Promise<Challenge> {
    const challenge = await this.getOrThrow(challengeId);
    if (challenge.opponentId !== userId)
      throw new ForbiddenException('Not your challenge to decline');
    await this.assertPending(challenge);
    return this.resolve(
      challenge,
      'declined',
      DOMAIN_EVENTS.CHALLENGE_DECLINED,
    );
  }

  async cancel(userId: string, challengeId: string): Promise<Challenge> {
    const challenge = await this.getOrThrow(challengeId);
    if (challenge.challengerId !== userId)
      throw new ForbiddenException('Not your challenge to cancel');
    await this.assertPending(challenge);
    return this.resolve(
      challenge,
      'cancelled',
      DOMAIN_EVENTS.CHALLENGE_CANCELLED,
    );
  }

  async listIncoming(userId: string): Promise<Challenge[]> {
    return this.challenges.find({
      where: { opponentId: userId, status: 'pending', ...this.unexpired() },
      relations: RELATIONS,
      order: { createdAt: 'DESC' },
    });
  }

  async listOutgoing(userId: string): Promise<Challenge[]> {
    return this.challenges.find({
      where: { challengerId: userId, status: 'pending', ...this.unexpired() },
      relations: RELATIONS,
      order: { createdAt: 'DESC' },
    });
  }

  private unexpired() {
    return { createdAt: MoreThan(new Date(Date.now() - challengeTtlMs())) };
  }

  private async getOrThrow(id: string): Promise<Challenge> {
    const challenge = await this.challenges.findOne({
      where: { id },
      relations: RELATIONS,
    });
    if (!challenge) throw new NotFoundException('Challenge not found');
    return challenge;
  }
}

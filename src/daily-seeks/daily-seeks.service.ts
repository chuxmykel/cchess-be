import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';

import {
  DAILY_DAYS,
  SECONDS_PER_DAY,
  type TimeControl,
} from '../chess/time-control.js';
import type { Game } from '../games/entities/game.entity.js';
import { GamesService } from '../games/games.service.js';
import {
  findBestOpponent,
  firstPlaysWhite,
  isValidRatingRange,
  type RatingRange,
  SEEK_COLORS,
  type SeekColor,
  type SeekCriteria,
} from '../matchmaking/seek-matching.js';
import type { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { DailySeek } from './entities/daily-seek.entity.js';

/** The most daily seeks a player may have waiting at once. */
export const MAX_DAILY_SEEKS = 10;

export interface DailySeekRequest {
  days: number;
  rated?: boolean;
  ratingRange?: RatingRange;
  color?: SeekColor;
}

export type DailySeekResult =
  { status: 'queued'; seek: DailySeek } | { status: 'matched'; game: Game };

function criteriaOf(seek: DailySeek): SeekCriteria {
  return {
    userId: seek.userId,
    initialSeconds: seek.initialSeconds,
    incrementSeconds: 0,
    rated: seek.rated,
    rating: seek.rating,
    ratingRange:
      seek.ratingBelow === null && seek.ratingAbove === null
        ? null
        : { below: seek.ratingBelow, above: seek.ratingAbove },
    color: seek.color,
  };
}

/**
 * Daily games' seeks: posted, and left. One that agrees with a seek
 * already waiting (see seek-matching.ts - the same rules as live ones)
 * starts the game there and then; otherwise it waits in the database until
 * one comes, however long - the game:created push tells both players.
 */
@Injectable()
export class DailySeeksService {
  constructor(
    @InjectRepository(DailySeek)
    private readonly seeks: Repository<DailySeek>,
    private readonly gamesService: GamesService,
    private readonly usersService: UsersService,
  ) {}

  async seek(user: User, request: DailySeekRequest): Promise<DailySeekResult> {
    if (!(DAILY_DAYS as readonly number[]).includes(request.days)) {
      throw new BadRequestException('Invalid days per move');
    }
    if (request.ratingRange && !isValidRatingRange(request.ratingRange)) {
      throw new BadRequestException('Invalid rating range');
    }
    const color = request.color ?? 'random';
    if (!SEEK_COLORS.includes(color)) {
      throw new BadRequestException('Invalid color');
    }
    await this.gamesService.assertDailyRoom(user.id);
    if (
      (await this.seeks.count({ where: { userId: user.id } })) >=
      MAX_DAILY_SEEKS
    ) {
      throw new ConflictException(
        `You can have at most ${MAX_DAILY_SEEKS} daily seeks waiting`,
      );
    }

    const tc: TimeControl = {
      initialSeconds: request.days * SECONDS_PER_DAY,
      incrementSeconds: 0,
    };
    const rated = request.rated !== false && !user.isGuest;
    const rating = user.isGuest
      ? null
      : Math.round(
          (await this.usersService.getOrCreateRating(user.id, 'daily')).rating,
        );
    const seek = this.seeks.create({
      user,
      userId: user.id,
      initialSeconds: tc.initialSeconds,
      rated,
      rating,
      ratingBelow: request.ratingRange?.below ?? null,
      ratingAbove: request.ratingRange?.above ?? null,
      color,
    });

    const opponentSeek = await this.claimOpponent(seek);
    if (!opponentSeek) {
      return { status: 'queued', seek: await this.seeks.save(seek) };
    }

    const opponent = await this.usersService.findByIdOrThrow(
      opponentSeek.userId,
    );
    const seekerWhite = firstPlaysWhite(color, opponentSeek.color);
    const game = await this.gamesService.createGame(
      seekerWhite ? user : opponent,
      seekerWhite ? opponent : user,
      tc,
      rated,
    );
    return { status: 'matched', game };
  }

  /**
   * Takes the waiting seek that pairs best with `seek`, deleting it so no
   * other seek can - the first to delete one wins it, on any worker, and a
   * seek lost to another is passed over for the next best. Seeks of
   * players with no room for another daily game are passed over too.
   */
  private async claimOpponent(seek: DailySeek): Promise<DailySeek | null> {
    const candidates = await this.seeks.find({
      where: {
        initialSeconds: seek.initialSeconds,
        rated: seek.rated,
        userId: Not(seek.userId),
      },
      order: { createdAt: 'ASC' },
    });
    const criteria = criteriaOf(seek);
    let waiting = candidates;
    for (;;) {
      const best = findBestOpponent(
        criteria,
        waiting.map((candidate) => ({ ...criteriaOf(candidate), candidate })),
      )?.candidate;
      if (!best) return null;
      waiting = waiting.filter((candidate) => candidate !== best);

      const roomForIt = await this.gamesService
        .assertDailyRoom(best.userId)
        .then(() => true)
        .catch(() => false);
      if (!roomForIt) continue;
      // deletedAt in the criteria: softDelete doesn't add it, and without it
      // a seek another request had just claimed would count as ours.
      const { affected } = await this.seeks.softDelete({
        id: best.id,
        deletedAt: IsNull(),
      });
      if (affected) return best;
    }
  }

  listMine(userId: string): Promise<DailySeek[]> {
    return this.seeks.find({ where: { userId }, order: { createdAt: 'ASC' } });
  }

  async cancel(userId: string, seekId: string): Promise<void> {
    const { affected } = await this.seeks.softDelete({
      id: seekId,
      userId,
      deletedAt: IsNull(),
    });
    if (!affected) throw new NotFoundException('Seek not found');
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Chess } from 'chess.js';
import { IsNull, LessThanOrEqual, MoreThan, Not, Repository } from 'typeorm';

import { Game } from '../games/entities/game.entity.js';
import type { NewPersonalPuzzleDto } from './dto/puzzle.dto.js';
import { PersonalPuzzle } from './entities/personal-puzzle.entity.js';
import { PuzzleAttempt } from './entities/puzzle-attempt.entity.js';
import { PuzzleRating } from './entities/puzzle-rating.entity.js';
import { Puzzle } from './entities/puzzle.entity.js';
import { rateAttempt } from './puzzle-rating.js';
import { nextSchedule } from './schedule.js';

/** How far from a player's puzzle rating a pool puzzle is looked for first,
 * then wider, then anywhere. */
export const PUZZLE_RATING_WINDOWS = [150, 400] as const;
/** A pool puzzle tried isn't served again for this long. */
export const PUZZLE_REPEAT_DAYS = 30;
/** The most personal puzzles due handed over at once. */
export const DUE_PAGE = 20;

@Injectable()
export class PuzzlesService {
  constructor(
    @InjectRepository(Puzzle)
    private readonly puzzles: Repository<Puzzle>,
    @InjectRepository(PuzzleAttempt)
    private readonly attempts: Repository<PuzzleAttempt>,
    @InjectRepository(PuzzleRating)
    private readonly ratings: Repository<PuzzleRating>,
    @InjectRepository(PersonalPuzzle)
    private readonly personal: Repository<PersonalPuzzle>,
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
  ) {}

  async ratingOf(userId: string): Promise<PuzzleRating> {
    const existing = await this.ratings.findOneBy({ userId });
    return existing ?? this.ratings.save(this.ratings.create({ userId }));
  }

  /** A pool puzzle for a player: near their puzzle rating - wider if none
   * is left there - of the theme if one's asked for, and none they've tried
   * lately. Null when the pool has nothing for them. */
  async next(userId: string, theme?: string): Promise<Puzzle | null> {
    const { rating } = await this.ratingOf(userId);
    for (const window of [...PUZZLE_RATING_WINDOWS, null]) {
      const query = this.puzzles
        .createQueryBuilder('p')
        .where(
          `NOT EXISTS (SELECT 1 FROM puzzle_attempts a
             WHERE a."userId" = :userId AND a."puzzleId" = p.id
               AND a."deletedAt" IS NULL
               AND a."createdAt" > now() - make_interval(days => :days))`,
          { userId, days: PUZZLE_REPEAT_DAYS },
        )
        .orderBy('random()')
        .limit(1);
      if (theme) query.andWhere(':theme = ANY(p.themes)', { theme });
      if (window !== null) {
        query.andWhere('p.rating BETWEEN :low AND :high', {
          // Whole numbers: the pool's ratings are, a player's not.
          low: Math.round(rating - window),
          high: Math.round(rating + window),
        });
      }
      const found = await query.getOne();
      if (found) return found;
    }
    return null;
  }

  /** A try at a pool puzzle: kept, and the player's puzzle rating moved. */
  async attempt(
    userId: string,
    puzzleId: string,
    solved: boolean,
  ): Promise<{ ratingBefore: number; ratingAfter: number }> {
    const puzzle = await this.puzzles.findOneBy({ id: puzzleId });
    if (!puzzle) throw new NotFoundException('Puzzle not found');
    const rating = await this.ratingOf(userId);
    const now = new Date();
    const next = rateAttempt(rating, puzzle, solved, now);
    const ratingBefore = rating.rating;
    await this.ratings.update(
      { userId },
      {
        rating: next.rating,
        deviation: next.deviation,
        volatility: next.volatility,
        lastRatedAt: now,
        attempts: rating.attempts + 1,
      },
    );
    await this.attempts.save(
      this.attempts.create({
        userId,
        puzzleId,
        solved,
        ratingBefore,
        ratingAfter: next.rating,
      }),
    );
    return { ratingBefore, ratingAfter: next.rating };
  }

  /** A player's own puzzles: those due now, and how many are being learnt
   * and learnt. */
  async mine(userId: string): Promise<{
    due: PersonalPuzzle[];
    dueCount: number;
    learning: number;
    mastered: number;
  }> {
    const now = new Date();
    const dueWhere = {
      userId,
      retiredAt: IsNull(),
      dueAt: LessThanOrEqual(now),
    };
    const [due, dueCount, learning, mastered] = await Promise.all([
      this.personal.find({
        where: dueWhere,
        order: { dueAt: 'ASC' },
        take: DUE_PAGE,
      }),
      this.personal.countBy(dueWhere),
      this.personal.countBy({
        userId,
        retiredAt: IsNull(),
        dueAt: MoreThan(now),
      }),
      this.personal.countBy({ userId, retiredAt: Not(IsNull()) }),
    ]);
    return { due, dueCount, learning, mastered };
  }

  /** Tactics a player missed in one of their games, from its review, kept
   * to practise - each checked (the position, the line legal from it), and
   * any kept already left as it is. How many were new. */
  async addMine(
    userId: string,
    gameId: string,
    items: NewPersonalPuzzleDto[],
  ): Promise<number> {
    const game = await this.games.findOneBy({ id: gameId });
    if (!game) throw new NotFoundException('Game not found');
    if (game.whiteId !== userId && game.blackId !== userId) {
      throw new ForbiddenException('Only your own games');
    }
    for (const item of items) assertLegalLine(item.fen, item.solution);
    if (items.length === 0) return 0;
    const result = await this.personal
      .createQueryBuilder()
      .insert()
      .values(
        items.map((item) => ({
          userId,
          gameId,
          ply: item.ply,
          fen: item.fen,
          solution: item.solution,
          themes: item.themes,
          dueAt: new Date(),
        })),
      )
      .orIgnore()
      .execute();
    return result.identifiers.filter(Boolean).length;
  }

  /** A try at one of a player's own puzzles: on along the schedule if found,
   * back to tomorrow if not. */
  async attemptMine(
    userId: string,
    id: string,
    solved: boolean,
  ): Promise<PersonalPuzzle> {
    const puzzle = await this.personal.findOneBy({ id, userId });
    if (!puzzle) throw new NotFoundException('Puzzle not found');
    const schedule = nextSchedule(puzzle.step, solved, new Date());
    puzzle.step = schedule.step;
    puzzle.dueAt = schedule.dueAt;
    puzzle.retiredAt = schedule.retiredAt;
    if (solved) puzzle.solvedCount += 1;
    else puzzle.failedCount += 1;
    return this.personal.save(puzzle);
  }
}

/** A 400 unless the line is legal, move by move, from the position. */
export function assertLegalLine(fen: string, line: string[]): void {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    throw new BadRequestException("That isn't a position");
  }
  for (const uci of line) {
    try {
      chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4],
      });
    } catch {
      throw new BadRequestException(`${uci} isn't legal there`);
    }
  }
}

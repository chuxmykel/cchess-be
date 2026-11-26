import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import type { SaveGameReviewDto } from './dto/game-review.dto.js';
import {
  GameReview,
  type PositionEval,
} from './entities/game-review.entity.js';
import { Move } from './entities/move.entity.js';
import { GamesService } from './games.service.js';
import {
  BADGE_KINDS,
  type BadgeKind,
  parseReviewDigests,
  type SideDigest,
} from './review-digests.js';

/** How many of a player's last reviewed games their patterns read. */
export const PATTERN_GAMES = 10;

export interface GameAccuracy {
  white: number;
  black: number;
}

/**
 * Finished games' reviews. The engine runs on the device of whoever asks for
 * a review first - the server has no CPU to spare for it (see docs/features.md, "Game
 * review") - and the evals it sends are kept here, so the game's other
 * player, or anyone looking at it later, sees the same review at once. A
 * review searched deeper replaces a shallower one.
 */
@Injectable()
export class GameReviewsService {
  constructor(
    @InjectRepository(GameReview)
    private readonly reviews: Repository<GameReview>,
    @InjectRepository(Move)
    private readonly moves: Repository<Move>,
    private readonly gamesService: GamesService,
  ) {}

  async get(gameId: string): Promise<GameReview> {
    const review = await this.reviews.findOneBy({ gameId });
    if (!review) throw new NotFoundException('This game has no review yet');
    return review;
  }

  /** Keeps a review - unless the one already kept was searched as deep. */
  async save(
    userId: string,
    gameId: string,
    dto: SaveGameReviewDto,
  ): Promise<GameReview> {
    const game = await this.gamesService.getGameOrThrow(gameId);
    if (game.status !== 'completed') {
      throw new BadRequestException('Only a finished game can be reviewed');
    }
    const moveCount = await this.moves.countBy({ gameId });
    if (dto.evals.length !== moveCount + 1) {
      throw new BadRequestException(
        `A review needs an eval for each of the game's ${moveCount + 1} positions`,
      );
    }
    const digests = dto.digests ? parseReviewDigests(dto.digests) : null;
    const existing = await this.reviews.findOneBy({ gameId });
    if (existing && existing.depth >= dto.depth) {
      // Kept as it is - but given the digests it was saved without.
      if (digests && !existing.digests) {
        await this.reviews.update({ gameId }, { digests });
        return this.get(gameId);
      }
      return existing;
    }
    await this.reviews.upsert(
      {
        gameId,
        createdById: userId,
        engine: dto.engine,
        depth: dto.depth,
        whiteAccuracy: dto.whiteAccuracy,
        blackAccuracy: dto.blackAccuracy,
        evals: dto.evals.map(toPositionEval),
        digests: digests ?? existing?.digests ?? null,
        deletedAt: null,
      },
      ['gameId'],
    );
    return this.get(gameId);
  }

  /** The digests of a review kept without them - or newer ones. */
  async saveDigests(gameId: string, value: unknown): Promise<void> {
    const digests = parseReviewDigests(value);
    await this.get(gameId);
    await this.reviews.update({ gameId }, { digests });
  }

  /**
   * A player's patterns, from the digests kept with their reviewed games:
   * their last games' own digests, newest first (`withGames`, for the
   * player themselves), and the badges they've earned in all of them.
   */
  async patterns(
    userId: string,
    withGames: boolean,
  ): Promise<{
    games: {
      gameId: string;
      color: 'w' | 'b';
      endedAt: Date | null;
      digest: SideDigest;
    }[];
    badges: Partial<Record<BadgeKind, number>>;
  }> {
    const games = withGames
      ? (
          await this.reviews.query(
            `SELECT g.id AS "gameId",
               CASE WHEN g."whiteId" = $1 THEN 'w' ELSE 'b' END AS color,
               g."endedAt" AS "endedAt",
               r.digests -> (CASE WHEN g."whiteId" = $1 THEN 'w' ELSE 'b' END)
                 AS digest
             FROM game_reviews r
             JOIN games g ON g.id = r."gameId" AND g."deletedAt" IS NULL
             WHERE r."deletedAt" IS NULL AND r.digests IS NOT NULL
               AND (g."whiteId" = $1 OR g."blackId" = $1)
             ORDER BY g."endedAt" DESC NULLS LAST
             LIMIT $2`,
            [userId, PATTERN_GAMES],
          )
        ).map(
          (row: {
            gameId: string;
            color: 'w' | 'b';
            endedAt: Date | null;
            digest: SideDigest;
          }) => row,
        )
      : [];
    const badgeRows: { badge: string; count: string }[] =
      await this.reviews.query(
        `SELECT badge, COUNT(*) AS count
         FROM game_reviews r
         JOIN games g ON g.id = r."gameId" AND g."deletedAt" IS NULL
         CROSS JOIN LATERAL jsonb_array_elements_text(
           r.digests -> (CASE WHEN g."whiteId" = $1 THEN 'w' ELSE 'b' END)
             -> 'badges'
         ) AS badge
         WHERE r."deletedAt" IS NULL AND r.digests IS NOT NULL
           AND (g."whiteId" = $1 OR g."blackId" = $1)
         GROUP BY badge`,
        [userId],
      );
    const badges: Partial<Record<BadgeKind, number>> = {};
    for (const { badge, count } of badgeRows) {
      if (BADGE_KINDS.includes(badge as BadgeKind)) {
        badges[badge as BadgeKind] = Number(count);
      }
    }
    return { games, badges };
  }

  /** Each reviewed game's accuracies, for a list of games. */
  async accuracies(gameIds: string[]): Promise<Map<string, GameAccuracy>> {
    if (gameIds.length === 0) return new Map();
    const rows = await this.reviews.find({
      select: { gameId: true, whiteAccuracy: true, blackAccuracy: true },
      where: { gameId: In(gameIds) },
    });
    return new Map(
      rows.map((row) => [
        row.gameId,
        { white: row.whiteAccuracy, black: row.blackAccuracy },
      ]),
    );
  }
}

// Only the fields an eval has, whatever else came with it.
function toPositionEval(dto: SaveGameReviewDto['evals'][number]): PositionEval {
  const score = (s: NonNullable<typeof dto.second>): PositionEval['score'] =>
    s.kind === 'cp'
      ? { kind: 'cp', cp: s.cp! }
      : { kind: 'mate', moves: s.moves!, winner: s.winner! };
  return {
    score: score(dto.score),
    pv: dto.pv,
    second: dto.second ? score(dto.second) : null,
    depth: dto.depth,
  };
}

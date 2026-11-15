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

export interface GameAccuracy {
  white: number;
  black: number;
}

/**
 * Finished games' reviews. The engine runs on the device of whoever asks for
 * a review first - the server has no CPU to spare for it (see README, "Game
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
    const existing = await this.reviews.findOneBy({ gameId });
    if (existing && existing.depth >= dto.depth) return existing;
    await this.reviews.upsert(
      {
        gameId,
        createdById: userId,
        engine: dto.engine,
        depth: dto.depth,
        whiteAccuracy: dto.whiteAccuracy,
        blackAccuracy: dto.blackAccuracy,
        evals: dto.evals.map(toPositionEval),
        deletedAt: null,
      },
      ['gameId'],
    );
    return this.get(gameId);
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

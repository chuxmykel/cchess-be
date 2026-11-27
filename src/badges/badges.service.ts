import {
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import type { Color } from 'chess.js';
import { In, Repository } from 'typeorm';

import { DOMAIN_EVENTS } from '../common/events.js';
import type { GameReview } from '../games/entities/game-review.entity.js';
import { Game } from '../games/entities/game.entity.js';
import { Move } from '../games/entities/move.entity.js';
import { isProvisional, Rating } from '../users/entities/rating.entity.js';
import { User } from '../users/entities/user.entity.js';
import type { GameBadgeKind } from './badge-kinds.js';
import {
  type GameForBadges,
  gameBadges,
  isGamesMilestone,
  ratingLinesCrossed,
  reviewBadges,
} from './badge-rules.js';
import type { BadgeDto } from './dto/badge.dto.js';
import { UserBadge } from './entities/user-badge.entity.js';

/** Badges a player has just earned - for the realtime gateway to tell them. */
export interface BadgesAwardedEvent {
  userId: string;
  badges: BadgeDto[];
}

type NewBadge = Pick<
  UserBadge,
  'userId' | 'kind' | 'gameId' | 'category' | 'value' | 'key'
>;

const SIDES: Color[] = ['w', 'b'];

/**
 * Awards badges: those a game earns when it ends (from the game alone), and
 * the milestones it reaches; those it earns when its review is saved (from
 * the review's scores and the app's classification of each move). Each is
 * awarded once, and its player told at once - the app shows a game's on its
 * result card.
 */
@Injectable()
export class BadgesService implements OnModuleDestroy {
  private readonly logger = new Logger(BadgesService.name);

  constructor(
    @InjectRepository(UserBadge)
    private readonly badges: Repository<UserBadge>,
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
    @InjectRepository(Move)
    private readonly moves: Repository<Move>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Rating)
    private readonly ratings: Repository<Rating>,
    private readonly events: EventEmitter2,
  ) {}

  // Awards under way after a game ended, finished before shutting down -
  // before the database connection closes under them.
  private readonly pending = new Set<Promise<void>>();

  @OnEvent(DOMAIN_EVENTS.GAME_ENDED)
  onGameEnded({ game }: { game: Game }): void {
    const award = this.awardForGame(game.id)
      .catch((error: unknown) => {
        this.logger.error(`Badges for game ${game.id} failed`, error);
      })
      .finally(() => this.pending.delete(award));
    this.pending.add(award);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(this.pending);
  }

  /** A finished game's badges, and the milestones it reached. */
  async awardForGame(gameId: string): Promise<void> {
    const game = await this.games.findOneBy({ id: gameId });
    if (!game || game.status !== 'completed') return;
    const forBadges = await this.forBadges(game);
    const awarded: NewBadge[] = [];
    for (const side of SIDES) {
      const userId = side === 'w' ? game.whiteId : game.blackId;
      awarded.push(
        ...gameBadges({ ...forBadges, side }).map((kind) =>
          gameBadge(userId, kind, game.id),
        ),
        ...(await this.milestones(game, side)),
      );
    }
    await this.award(awarded);
  }

  /** The badges a game's review earns its players. */
  async awardForReview(review: GameReview): Promise<void> {
    if (!review.moveClasses) return;
    const game = await this.games.findOneBy({ id: review.gameId });
    if (!game) return;
    const forBadges = await this.forBadges(game);
    if (review.moveClasses.length !== forBadges.moves.length) return;
    const awarded = SIDES.flatMap((side) => {
      const userId = side === 'w' ? game.whiteId : game.blackId;
      return reviewBadges(
        { ...forBadges, side },
        {
          scores: review.evals.map((e) => e.score),
          classes: review.moveClasses ?? [],
          accuracy: side === 'w' ? review.whiteAccuracy : review.blackAccuracy,
        },
      ).map((kind) => gameBadge(userId, kind, game.id));
    });
    await this.award(awarded);
  }

  /** A player's badges, the newest first. */
  async list(username: string): Promise<BadgeDto[]> {
    const user = await this.users.findOneBy({ username });
    if (!user || user.accountDeletedAt) {
      throw new NotFoundException('User not found');
    }
    const badges = await this.badges.find({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });
    return this.toDtos(badges);
  }

  /** Each side's badges from one game: those its review shows. */
  async forGame(gameId: string): Promise<Record<Color, GameBadgeKind[]>> {
    const game = await this.games.findOneBy({ id: gameId });
    const found = await this.badges.findBy({ gameId });
    const of = (userId: string | undefined) =>
      found
        .filter((b) => b.userId === userId && b.value === null)
        .map((b) => b.kind as GameBadgeKind);
    return { w: of(game?.whiteId), b: of(game?.blackId) };
  }

  private async forBadges(game: Game): Promise<Omit<GameForBadges, 'side'>> {
    const moves = await this.moves.find({
      where: { gameId: game.id },
      order: { ply: 'ASC' },
    });
    return {
      result: game.result,
      moves,
      clock:
        game.gameType === 'daily'
          ? null
          : {
              initialMs: game.initialSeconds * 1000,
              incrementMs: game.incrementSeconds * 1000,
            },
      bullet: game.gameType === 'bullet',
      ratings: { w: game.whiteRatingAtStart, b: game.blackRatingAtStart },
    };
  }

  // The milestones a game reached for one side: its games finished, if a
  // power of ten; each rating line it crossed going up - once the rating
  // is certain: a provisional one (shown with a "?") reaches none.
  private async milestones(game: Game, side: Color): Promise<NewBadge[]> {
    const userId = side === 'w' ? game.whiteId : game.blackId;
    const reached: NewBadge[] = [];
    const finished = await this.games
      .createQueryBuilder('g')
      .where('(g.whiteId = :userId OR g.blackId = :userId)', { userId })
      .andWhere("g.status = 'completed'")
      .getCount();
    if (isGamesMilestone(finished)) {
      reached.push({
        userId,
        kind: 'gamesPlayed',
        gameId: game.id,
        category: null,
        value: finished,
        key: `gamesPlayed:${finished}`,
      });
    }
    const before =
      side === 'w' ? game.whiteRatingAtStart : game.blackRatingAtStart;
    const diff = side === 'w' ? game.whiteRatingDiff : game.blackRatingDiff;
    // Saved before the game's end is announced: the rating after it.
    const rating =
      game.rated && diff !== null && diff > 0
        ? await this.ratings.findOneBy({ userId, category: game.gameType })
        : null;
    if (
      rating &&
      !isProvisional(rating.deviation) &&
      before !== null &&
      diff !== null
    ) {
      for (const line of ratingLinesCrossed(before, before + diff)) {
        reached.push({
          userId,
          kind: 'ratingReached',
          gameId: game.id,
          category: game.gameType,
          value: line,
          key: `ratingReached:${game.gameType}:${line}`,
        });
      }
    }
    return reached;
  }

  // Keeps the badges not had already, and tells each player of theirs.
  private async award(badges: NewBadge[]): Promise<void> {
    if (badges.length === 0) return;
    const result = await this.badges
      .createQueryBuilder()
      .insert()
      .values(badges)
      .orIgnore()
      .returning('id')
      .execute();
    const ids = (result.raw as { id: string }[]).map((row) => row.id);
    if (ids.length === 0) return;
    const saved = await this.badges.findBy({ id: In(ids) });
    const dtos = await this.toDtos(saved);
    const byUser = new Map<string, BadgeDto[]>();
    saved.forEach((badge, i) => {
      byUser.set(badge.userId, [...(byUser.get(badge.userId) ?? []), dtos[i]]);
    });
    for (const [userId, earned] of byUser) {
      this.events.emit(DOMAIN_EVENTS.BADGES_AWARDED, {
        userId,
        badges: earned,
      } satisfies BadgesAwardedEvent);
    }
  }

  // Each with its game.
  private async toDtos(badges: UserBadge[]): Promise<BadgeDto[]> {
    const gameIds = [
      ...new Set(badges.map((b) => b.gameId).filter((id) => id !== null)),
    ];
    const games = gameIds.length
      ? await this.games.find({
          where: { id: In(gameIds) },
          relations: { white: true, black: true },
        })
      : [];
    const gameById = new Map(games.map((g) => [g.id, g]));
    return badges.map((badge) => {
      const game = badge.gameId ? gameById.get(badge.gameId) : undefined;
      const asWhite = game?.whiteId === badge.userId;
      const opponent = game ? (asWhite ? game.black : game.white) : null;
      return {
        id: badge.id,
        kind: badge.kind,
        game:
          game && opponent
            ? {
                gameId: game.id,
                opponentUsername: opponent.username,
                opponentDisplayName: opponent.displayName,
                result:
                  game.result === null
                    ? null
                    : game.result === 'draw'
                      ? 'draw'
                      : (game.result === 'white') === asWhite
                        ? 'win'
                        : 'loss',
                endedAt: game.endedAt,
              }
            : null,
        category: badge.category,
        value: badge.value,
        awardedAt: badge.createdAt,
      };
    });
  }
}

const gameBadge = (
  userId: string,
  kind: GameBadgeKind,
  gameId: string,
): NewBadge => ({
  userId,
  kind,
  gameId,
  category: null,
  value: null,
  key: `${kind}:${gameId}`,
});

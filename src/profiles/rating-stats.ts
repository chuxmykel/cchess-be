import type { Game } from '../games/entities/game.entity.js';
import type { User } from '../users/entities/user.entity.js';
import { outcomeFor, type Score } from './game-stats.js';

export const RATING_STATS_PERIODS = ['1w', '1m', '3m', '1y', 'all'] as const;
export type RatingStatsPeriod = (typeof RATING_STATS_PERIODS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS: Record<Exclude<RatingStatsPeriod, 'all'>, number> = {
  '1w': 7,
  '1m': 30,
  '3m': 90,
  '1y': 365,
};

/** When the period starts, or null for all time. */
export function periodStart(period: RatingStatsPeriod, now: Date): Date | null {
  if (period === 'all') return null;
  return new Date(now.getTime() - PERIOD_DAYS[period] * DAY_MS);
}

export interface RatingPoint {
  at: Date;
  rating: number;
}

export interface NotableGame {
  gameId: string;
  opponentUsername: string;
  opponentDisplayName: string;
  /** The opponent's rating when the game started. */
  opponentRating: number;
  endedAt: Date;
}

export interface RatingStats extends Score {
  /** The rating going into the period's first rated game, then after each
   * rated game, oldest first. */
  history: RatingPoint[];
  highest: RatingPoint | null;
  lowest: RatingPoint | null;
  /** Points gained (or lost, below zero) over the period's rated games. */
  ratingChange: number | null;
  games: number;
  timePlayedMs: number;
  /** The win over the highest-rated opponent, in a rated game. */
  bestWin: NotableGame | null;
  /** The loss to the lowest-rated opponent, in a rated game. */
  worstLoss: NotableGame | null;
  longestWinStreak: number;
  longestLosingStreak: number;
}

export type RatingStatsGame = Pick<
  Game,
  | 'id'
  | 'whiteId'
  | 'blackId'
  | 'result'
  | 'rated'
  | 'createdAt'
  | 'endedAt'
  | 'whiteRatingAtStart'
  | 'blackRatingAtStart'
  | 'whiteRatingDiff'
  | 'blackRatingDiff'
> & {
  white: Pick<User, 'username' | 'displayName'>;
  black: Pick<User, 'username' | 'displayName'>;
};

type EndedGame = RatingStatsGame & { endedAt: Date };

function notableGame(
  game: EndedGame,
  asWhite: boolean,
  opponentRating: number,
): NotableGame {
  const opponent = asWhite ? game.black : game.white;
  return {
    gameId: game.id,
    opponentUsername: opponent.username,
    opponentDisplayName: opponent.displayName,
    opponentRating,
    endedAt: game.endedAt,
  };
}

/** One category's finished games over a period, from the user's side. */
export function summarizeRatingStats(
  games: RatingStatsGame[],
  userId: string,
): RatingStats {
  const stats: RatingStats = {
    history: [],
    highest: null,
    lowest: null,
    ratingChange: null,
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    timePlayedMs: 0,
    bestWin: null,
    worstLoss: null,
    longestWinStreak: 0,
    longestLosingStreak: 0,
  };
  let winStreak = 0;
  let losingStreak = 0;
  const oldestFirst = games
    .filter((game): game is EndedGame => Boolean(game.endedAt))
    .sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime());

  for (const game of oldestFirst) {
    const asWhite = game.whiteId === userId;
    const outcome = outcomeFor(game, userId);
    stats.games += 1;
    stats.timePlayedMs += game.endedAt.getTime() - game.createdAt.getTime();
    if (outcome) stats[outcome] += 1;

    winStreak = outcome === 'wins' ? winStreak + 1 : 0;
    losingStreak = outcome === 'losses' ? losingStreak + 1 : 0;
    stats.longestWinStreak = Math.max(stats.longestWinStreak, winStreak);
    stats.longestLosingStreak = Math.max(
      stats.longestLosingStreak,
      losingStreak,
    );

    const ratingAtStart = asWhite
      ? game.whiteRatingAtStart
      : game.blackRatingAtStart;
    const ratingDiff = asWhite ? game.whiteRatingDiff : game.blackRatingDiff;
    if (!game.rated || ratingAtStart === null || ratingDiff === null) continue;

    if (stats.history.length === 0) {
      stats.history.push({ at: game.createdAt, rating: ratingAtStart });
    }
    stats.history.push({
      at: game.endedAt,
      rating: ratingAtStart + ratingDiff,
    });

    const opponentRating = asWhite
      ? game.blackRatingAtStart
      : game.whiteRatingAtStart;
    if (opponentRating === null) continue;
    if (
      outcome === 'wins' &&
      opponentRating > (stats.bestWin?.opponentRating ?? -Infinity)
    ) {
      stats.bestWin = notableGame(game, asWhite, opponentRating);
    }
    if (
      outcome === 'losses' &&
      opponentRating < (stats.worstLoss?.opponentRating ?? Infinity)
    ) {
      stats.worstLoss = notableGame(game, asWhite, opponentRating);
    }
  }

  for (const point of stats.history) {
    if (!stats.highest || point.rating > stats.highest.rating) {
      stats.highest = point;
    }
    if (!stats.lowest || point.rating < stats.lowest.rating) {
      stats.lowest = point;
    }
  }
  const first = stats.history.at(0);
  const last = stats.history.at(-1);
  if (first && last) stats.ratingChange = last.rating - first.rating;
  return stats;
}

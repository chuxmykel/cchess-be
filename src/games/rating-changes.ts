import type { GameResult } from './entities/game.entity.js';
import {
  type GameScore,
  type Glicko2Rating,
  rateGame,
  ratingPeriodsBetween,
} from './glicko2.js';

/** A player's rating as it stands, and when it last changed - a returning
 * player's deviation grows with the time since. */
export type RatingBefore = Glicko2Rating & { lastRatedAt: Date | null };

export interface RatingChanges {
  white: Glicko2Rating;
  black: Glicko2Rating;
  /** The rounded points each gained, or lost - what a game records. */
  whiteDiff: number;
  blackDiff: number;
}

function scoreFor(
  color: 'white' | 'black',
  result: Exclude<GameResult, null>,
): GameScore {
  if (result === 'draw') return 0.5;
  return result === color ? 1 : 0;
}

function roundedChange(before: Glicko2Rating, after: Glicko2Rating): number {
  return Math.round(after.rating) - Math.round(before.rating);
}

/** What a rated game ending in `result` at `ratedAt` does to both
 * players' ratings, each rated against the other's rating before it. */
export function ratingChangesFor(
  white: RatingBefore,
  black: RatingBefore,
  result: Exclude<GameResult, null>,
  ratedAt: Date,
): RatingChanges {
  const whiteAfter = rateGame(
    white,
    black,
    scoreFor('white', result),
    ratingPeriodsBetween(white.lastRatedAt, ratedAt),
  );
  const blackAfter = rateGame(
    black,
    white,
    scoreFor('black', result),
    ratingPeriodsBetween(black.lastRatedAt, ratedAt),
  );
  return {
    white: whiteAfter,
    black: blackAfter,
    whiteDiff: roundedChange(white, whiteAfter),
    blackDiff: roundedChange(black, blackAfter),
  };
}

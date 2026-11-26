import {
  type Glicko2Rating,
  rateGame,
  ratingPeriodsBetween,
} from '../games/glicko2.js';
import { STARTING_VOLATILITY } from '../users/entities/rating.entity.js';

/** A player's puzzle rating after a try at a pool puzzle: a game against
 * the puzzle, won if it was solved - the puzzle's own rating and deviation
 * as lichess's players have set them. */
export function rateAttempt(
  player: Glicko2Rating & { lastRatedAt: Date | null },
  puzzle: { rating: number; ratingDeviation: number },
  solved: boolean,
  now: Date,
): Glicko2Rating {
  return rateGame(
    player,
    {
      rating: puzzle.rating,
      deviation: puzzle.ratingDeviation,
      volatility: STARTING_VOLATILITY,
    },
    solved ? 1 : 0,
    // At least one period: puzzles come many a day, and each should move it.
    Math.max(1, ratingPeriodsBetween(player.lastRatedAt, now)),
  );
}

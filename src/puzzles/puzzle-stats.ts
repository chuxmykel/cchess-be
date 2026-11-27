import {
  dailyCloses,
  type RatingPoint,
  thinHistory,
} from '../profiles/rating-stats.js';

/** A try at a pool puzzle, with the puzzle's own rating and themes. */
export interface PuzzleStatsAttempt {
  puzzleId: string;
  puzzleRating: number;
  themes: string[];
  solved: boolean;
  ratingBefore: number;
  ratingAfter: number;
  createdAt: Date;
}

export interface ThemeRecord {
  theme: string;
  attempts: number;
  solved: number;
}

export interface PuzzleStats {
  /** The rating going into the period's first try, then each day's
   * closing rating, oldest first - thinned for a chart. */
  history: RatingPoint[];
  highest: RatingPoint | null;
  lowest: RatingPoint | null;
  /** Points gained (or lost, below zero) over the period. */
  ratingChange: number | null;
  attempts: number;
  solved: number;
  missed: number;
  /** The highest-rated puzzle solved. */
  bestSolve: { puzzleId: string; rating: number; at: Date } | null;
  longestSolvedStreak: number;
  longestMissedStreak: number;
  /** Each theme tried, the most tried first. */
  themes: ThemeRecord[];
}

/** A player's tries at pool puzzles over a period, oldest first. */
export function summarizePuzzleStats(
  attempts: PuzzleStatsAttempt[],
): PuzzleStats {
  const oldestFirst = [...attempts].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  let history: RatingPoint[] = [];
  let highest: RatingPoint | null = null;
  let lowest: RatingPoint | null = null;
  let solved = 0;
  let bestSolve: PuzzleStats['bestSolve'] = null;
  let solvedStreak = 0;
  let missedStreak = 0;
  let longestSolvedStreak = 0;
  let longestMissedStreak = 0;
  const themes = new Map<string, ThemeRecord>();

  for (const attempt of oldestFirst) {
    if (history.length === 0) {
      history.push({ at: attempt.createdAt, rating: attempt.ratingBefore });
    }
    history.push({ at: attempt.createdAt, rating: attempt.ratingAfter });

    if (attempt.solved) {
      solved += 1;
      if (attempt.puzzleRating > (bestSolve?.rating ?? -Infinity)) {
        bestSolve = {
          puzzleId: attempt.puzzleId,
          rating: attempt.puzzleRating,
          at: attempt.createdAt,
        };
      }
    }
    solvedStreak = attempt.solved ? solvedStreak + 1 : 0;
    missedStreak = attempt.solved ? 0 : missedStreak + 1;
    longestSolvedStreak = Math.max(longestSolvedStreak, solvedStreak);
    longestMissedStreak = Math.max(longestMissedStreak, missedStreak);

    for (const theme of attempt.themes) {
      const record = themes.get(theme) ?? { theme, attempts: 0, solved: 0 };
      record.attempts += 1;
      if (attempt.solved) record.solved += 1;
      themes.set(theme, record);
    }
  }

  for (const point of history) {
    if (!highest || point.rating > highest.rating) highest = point;
    if (!lowest || point.rating < lowest.rating) lowest = point;
  }
  const first = history.at(0);
  const last = history.at(-1);
  const ratingChange =
    first && last ? Math.round(last.rating) - Math.round(first.rating) : null;
  // The figures above come from every try; the chart shows each day's
  // closing rating, rounded as the rating is shown.
  history = thinHistory(dailyCloses(history)).map((point) => ({
    at: point.at,
    rating: Math.round(point.rating),
  }));
  const round = (point: RatingPoint | null) =>
    point && { at: point.at, rating: Math.round(point.rating) };

  return {
    history,
    highest: round(highest),
    lowest: round(lowest),
    ratingChange,
    attempts: oldestFirst.length,
    solved,
    missed: oldestFirst.length - solved,
    bestSolve,
    longestSolvedStreak,
    longestMissedStreak,
    themes: [...themes.values()].sort((a, b) => b.attempts - a.attempts),
  };
}

import { describe, expect, it } from 'vitest';

import {
  type PuzzleStatsAttempt,
  summarizePuzzleStats,
} from './puzzle-stats.js';

let rating = 1500;
/** A try on 20 October 2026, at the given hour and minute. */
function attempt(
  day: number,
  minute: number,
  solved: boolean,
  overrides: Partial<PuzzleStatsAttempt> = {},
): PuzzleStatsAttempt {
  const before = rating;
  rating += solved ? 10 : -10;
  return {
    puzzleId: `p${day}-${minute}`,
    puzzleRating: 1500,
    themes: ['fork'],
    solved,
    ratingBefore: before,
    ratingAfter: rating,
    createdAt: new Date(Date.UTC(2026, 9, day, 10, minute)),
    ...overrides,
  };
}

describe('summarizePuzzleStats', () => {
  it('has nothing to say of no tries', () => {
    expect(summarizePuzzleStats([])).toMatchObject({
      history: [],
      highest: null,
      lowest: null,
      ratingChange: null,
      attempts: 0,
      bestSolve: null,
      themes: [],
    });
  });

  it('charts the rating going in, then each day it closed at', () => {
    rating = 1500;
    const stats = summarizePuzzleStats([
      attempt(20, 0, true),
      attempt(20, 5, true),
      attempt(21, 0, false),
    ]);

    expect(stats.history.map((p) => p.rating)).toEqual([1500, 1520, 1510]);
    expect(stats.ratingChange).toBe(10);
    expect(stats.highest?.rating).toBe(1520);
    expect(stats.lowest?.rating).toBe(1500);
  });

  it('counts tries, solves and streaks, and the best solve', () => {
    rating = 1500;
    const stats = summarizePuzzleStats([
      attempt(20, 0, true, { puzzleRating: 1400 }),
      attempt(20, 1, true, { puzzleRating: 1800, puzzleId: 'hard' }),
      attempt(20, 2, true, { puzzleRating: 1600 }),
      attempt(20, 3, false, { puzzleRating: 2000 }),
      attempt(20, 4, false),
    ]);

    expect(stats).toMatchObject({
      attempts: 5,
      solved: 3,
      missed: 2,
      longestSolvedStreak: 3,
      longestMissedStreak: 2,
    });
    expect(stats.bestSolve).toMatchObject({ puzzleId: 'hard', rating: 1800 });
  });

  it('keeps each theme tried, the most tried first', () => {
    rating = 1500;
    const stats = summarizePuzzleStats([
      attempt(20, 0, true, { themes: ['pin', 'middlegame'] }),
      attempt(20, 1, false, { themes: ['fork', 'middlegame'] }),
      attempt(20, 2, true, { themes: ['fork'] }),
    ]);

    expect(stats.themes[0]).toEqual({
      theme: 'middlegame',
      attempts: 2,
      solved: 1,
    });
    expect(stats.themes).toContainEqual({
      theme: 'fork',
      attempts: 2,
      solved: 1,
    });
    expect(stats.themes).toContainEqual({
      theme: 'pin',
      attempts: 1,
      solved: 1,
    });
  });

  it('rounds the ratings it shows', () => {
    const stats = summarizePuzzleStats([
      {
        puzzleId: 'p',
        puzzleRating: 1500,
        themes: [],
        solved: true,
        ratingBefore: 1500,
        ratingAfter: 1512.6,
        createdAt: new Date(Date.UTC(2026, 9, 20)),
      },
    ]);

    expect(stats.history.map((p) => p.rating)).toEqual([1500, 1513]);
    expect(stats.ratingChange).toBe(13);
  });
});

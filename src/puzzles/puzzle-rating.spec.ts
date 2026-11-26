import { describe, expect, it } from 'vitest';

import { rateAttempt } from './puzzle-rating.js';

const PLAYER = {
  rating: 1500,
  deviation: 200,
  volatility: 0.06,
  lastRatedAt: null,
};
const NOW = new Date('2026-11-26T12:00:00Z');

describe('rateAttempt', () => {
  it('raises the rating for a solve and lowers it for a miss', () => {
    const puzzle = { rating: 1500, ratingDeviation: 80 };
    expect(rateAttempt(PLAYER, puzzle, true, NOW).rating).toBeGreaterThan(1500);
    expect(rateAttempt(PLAYER, puzzle, false, NOW).rating).toBeLessThan(1500);
  });

  it('moves it more for solving a harder puzzle', () => {
    const easy = rateAttempt(
      PLAYER,
      { rating: 1100, ratingDeviation: 80 },
      true,
      NOW,
    );
    const hard = rateAttempt(
      PLAYER,
      { rating: 1900, ratingDeviation: 80 },
      true,
      NOW,
    );
    expect(hard.rating - 1500).toBeGreaterThan(easy.rating - 1500);
  });
});

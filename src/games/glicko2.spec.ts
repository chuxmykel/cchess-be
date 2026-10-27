import { describe, expect, it } from 'vitest';

import {
  MIN_DEVIATION,
  rateGame,
  ratingPeriodsBetween,
  RATING_PERIOD_DAYS,
  updateRating,
  type Glicko2Rating,
} from './glicko2.js';
import { STARTING_DEVIATION } from '../users/entities/rating.entity.js';

const NEW_PLAYER: Glicko2Rating = {
  rating: 1500,
  deviation: 350,
  volatility: 0.06,
};

describe('updateRating', () => {
  it("reproduces the worked example from Glickman's paper", () => {
    const player = { rating: 1500, deviation: 200, volatility: 0.06 };
    const opponent = (rating: number, deviation: number) => ({
      rating,
      deviation,
      volatility: 0.06,
    });

    const updated = updateRating(
      player,
      [
        { opponent: opponent(1400, 30), score: 1 },
        { opponent: opponent(1550, 100), score: 0 },
        { opponent: opponent(1700, 300), score: 0 },
      ],
      { volatilityConstraint: 0.5 },
    );

    expect(updated.rating).toBeCloseTo(1464.06, 1);
    expect(updated.deviation).toBeCloseTo(151.52, 1);
    const paperFinalA = -5.62696;
    expect(updated.volatility).toBeCloseTo(Math.exp(paperFinalA / 2), 6);
  });

  it('grows only the deviation for a player with no games in the period', () => {
    const updated = updateRating(
      { rating: 1700, deviation: 50, volatility: 0.06 },
      [],
      { volatilityConstraint: 0.5 },
    );

    expect(updated.rating).toBe(1700);
    expect(updated.volatility).toBe(0.06);
    expect(updated.deviation).toBeCloseTo(
      Math.sqrt((50 / 173.7178) ** 2 + 0.06 ** 2) * 173.7178,
      6,
    );
  });

  it('converges on a result far beyond what the ratings predicted', () => {
    const updated = updateRating(
      { rating: 1200, deviation: 60, volatility: 0.06 },
      Array.from({ length: 10 }, () => ({
        opponent: { rating: 2400, deviation: 50, volatility: 0.06 },
        score: 1 as const,
      })),
      { volatilityConstraint: 0.5 },
    );

    expect(updated.rating).toBeGreaterThan(1200);
    expect(updated.volatility).toBeGreaterThan(0.06);
    expect(Number.isFinite(updated.volatility)).toBe(true);
  });

  it('caps the deviation going into the period, and floors it coming out', () => {
    const longInactive = updateRating(
      { rating: 1500, deviation: 340, volatility: 0.06 },
      [],
      {
        volatilityConstraint: 0.5,
        elapsedRatingPeriods: 1000,
        maxDeviation: 350,
      },
    );
    const veryCertain = updateRating(
      { rating: 1500, deviation: 45, volatility: 0.06 },
      [
        {
          opponent: { rating: 1500, deviation: 45, volatility: 0.06 },
          score: 1,
        },
      ],
      { volatilityConstraint: 0.5, elapsedRatingPeriods: 0, minDeviation: 45 },
    );

    expect(longInactive.deviation).toBeCloseTo(350, 6);
    expect(veryCertain.deviation).toBe(45);
  });
});

describe('rateGame', () => {
  it('moves two new players apart by equal amounts', () => {
    const winner = rateGame(NEW_PLAYER, NEW_PLAYER, 1, 1);
    const loser = rateGame(NEW_PLAYER, NEW_PLAYER, 0, 1);

    expect(winner.rating - 1500).toBeCloseTo(1500 - loser.rating, 6);
    expect(winner.rating).toBeGreaterThan(1600);
    expect(winner.deviation).toBeLessThan(350);
  });

  it('leaves equal players level after a draw', () => {
    const drawn = rateGame(NEW_PLAYER, NEW_PLAYER, 0.5, 1);

    expect(drawn.rating).toBeCloseTo(1500, 6);
  });

  it('moves a settled rating far less than a new one', () => {
    const settled = { rating: 1500, deviation: 60, volatility: 0.06 };

    const settledChange = rateGame(settled, settled, 1, 0).rating - 1500;
    const newChange = rateGame(NEW_PLAYER, NEW_PLAYER, 1, 1).rating - 1500;

    expect(settledChange).toBeLessThan(newChange / 4);
  });

  it('keeps the deviation within its floor and cap', () => {
    const settled = {
      rating: 1500,
      deviation: MIN_DEVIATION,
      volatility: 0.06,
    };

    expect(rateGame(settled, settled, 1, 0).deviation).toBe(MIN_DEVIATION);
    expect(rateGame(NEW_PLAYER, NEW_PLAYER, 1, 10_000).deviation).toBeLessThan(
      STARTING_DEVIATION,
    );
  });
});

describe('ratingPeriodsBetween', () => {
  it('counts a first rated game as one rating period', () => {
    expect(ratingPeriodsBetween(null, new Date())).toBe(1);
  });

  it('measures the time since the last rated game in rating periods', () => {
    const now = new Date('2026-10-27T00:00:00Z');
    const lastRatedAt = new Date(
      now.getTime() - 2 * RATING_PERIOD_DAYS * 24 * 60 * 60 * 1000,
    );

    expect(ratingPeriodsBetween(lastRatedAt, now)).toBeCloseTo(2, 9);
  });
});

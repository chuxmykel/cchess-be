import { describe, expect, it } from 'vitest';

import {
  STARTING_DEVIATION,
  STARTING_RATING,
  STARTING_VOLATILITY,
} from '../users/entities/rating.entity.js';
import { type RatingBefore, ratingChangesFor } from './rating-changes.js';

const RATED_AT = new Date('2026-11-01T12:00:00Z');
const A_YEAR_AGO = new Date('2025-11-01T12:00:00Z');

const NEW_PLAYER: RatingBefore = {
  rating: STARTING_RATING,
  deviation: STARTING_DEVIATION,
  volatility: STARTING_VOLATILITY,
  lastRatedAt: null,
};

function settled(lastRatedAt: Date = RATED_AT): RatingBefore {
  return { ...NEW_PLAYER, deviation: 60, lastRatedAt };
}

describe('ratingChangesFor', () => {
  it('moves the winner up and the loser down by the same rounded points', () => {
    const changes = ratingChangesFor(NEW_PLAYER, NEW_PLAYER, 'black', RATED_AT);

    expect(changes.blackDiff).toBeGreaterThan(0);
    expect(changes.whiteDiff).toBe(-changes.blackDiff);
    expect(changes.blackDiff).toBe(
      Math.round(changes.black.rating) - STARTING_RATING,
    );
  });

  it('leaves equal players level after a draw', () => {
    const changes = ratingChangesFor(NEW_PLAYER, NEW_PLAYER, 'draw', RATED_AT);

    expect(changes.whiteDiff).toBe(0);
    expect(changes.blackDiff).toBe(0);
  });

  it('moves a settled rating far less than a new one', () => {
    const settledGain = ratingChangesFor(
      settled(),
      settled(),
      'black',
      RATED_AT,
    ).blackDiff;
    const newGain = ratingChangesFor(
      NEW_PLAYER,
      NEW_PLAYER,
      'black',
      RATED_AT,
    ).blackDiff;

    expect(settledGain).toBeGreaterThan(0);
    expect(settledGain).toBeLessThan(newGain / 4);
  });

  it("grows a returning player's deviation for the time since their last rated game", () => {
    const regularLoss = -ratingChangesFor(
      settled(RATED_AT),
      settled(),
      'black',
      RATED_AT,
    ).whiteDiff;
    const returningLoss = -ratingChangesFor(
      settled(A_YEAR_AGO),
      settled(),
      'black',
      RATED_AT,
    ).whiteDiff;

    expect(returningLoss).toBeGreaterThan(regularLoss);
  });
});

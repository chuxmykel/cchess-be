import { describe, expect, it } from 'vitest';

import { computeGameEloDeltas } from './elo.js';

describe('computeGameEloDeltas', () => {
  it('rewards the winner and penalizes the loser by equal and opposite amounts for equal ratings', () => {
    const { whiteDelta, blackDelta } = computeGameEloDeltas({
      whiteRating: 1200,
      whiteGamesPlayed: 10,
      blackRating: 1200,
      blackGamesPlayed: 10,
      result: 'white',
    });
    expect(whiteDelta).toBeGreaterThan(0);
    expect(blackDelta).toBeLessThan(0);
    expect(whiteDelta).toBe(-blackDelta);
  });

  it('gives a draw between equal ratings a zero delta', () => {
    const { whiteDelta, blackDelta } = computeGameEloDeltas({
      whiteRating: 1500,
      whiteGamesPlayed: 50,
      blackRating: 1500,
      blackGamesPlayed: 50,
      result: 'draw',
    });
    expect(whiteDelta).toBe(0);
    expect(blackDelta).toBe(0);
  });

  it('moves a much lower-rated winner up by close to the full K-factor', () => {
    const { whiteDelta } = computeGameEloDeltas({
      whiteRating: 1000,
      whiteGamesPlayed: 50,
      blackRating: 2000,
      blackGamesPlayed: 50,
      result: 'white',
    });
    expect(whiteDelta).toBeGreaterThanOrEqual(19);
    expect(whiteDelta).toBeLessThanOrEqual(20);
  });

  it('uses a larger K-factor for provisional (new) players', () => {
    const provisional = computeGameEloDeltas({
      whiteRating: 1200,
      whiteGamesPlayed: 0,
      blackRating: 1200,
      blackGamesPlayed: 0,
      result: 'white',
    });
    const established = computeGameEloDeltas({
      whiteRating: 1200,
      whiteGamesPlayed: 100,
      blackRating: 1200,
      blackGamesPlayed: 100,
      result: 'white',
    });
    expect(provisional.whiteDelta).toBeGreaterThan(established.whiteDelta);
  });
});

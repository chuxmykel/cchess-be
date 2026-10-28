import { describe, expect, it } from 'vitest';

import type { Game } from './entities/game.entity.js';
import { seriesForRematchOf, seriesPointsAfter } from './rematch-series.js';

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: 'game-1',
    result: null,
    rematchOfId: null,
    seriesWhitePoints: 0,
    seriesBlackPoints: 0,
    ...overrides,
  } as Game;
}

describe('seriesPointsAfter', () => {
  it("adds the game's result to the points going into it", () => {
    const base = { seriesWhitePoints: 1.5, seriesBlackPoints: 0.5 };

    expect(seriesPointsAfter(game({ ...base, result: 'white' }))).toEqual({
      white: 2.5,
      black: 0.5,
    });
    expect(seriesPointsAfter(game({ ...base, result: 'black' }))).toEqual({
      white: 1.5,
      black: 1.5,
    });
    expect(seriesPointsAfter(game({ ...base, result: 'draw' }))).toEqual({
      white: 2,
      black: 1,
    });
  });

  it('counts nothing for a game without a result', () => {
    expect(
      seriesPointsAfter(game({ seriesWhitePoints: 1, result: null })),
    ).toEqual({ white: 1, black: 0 });
  });
});

describe('seriesForRematchOf', () => {
  it("carries each player's points to the color they swap to", () => {
    expect(
      seriesForRematchOf(
        game({ id: 'g', result: 'white', seriesBlackPoints: 2 }),
      ),
    ).toEqual({ rematchOfId: 'g', whitePoints: 2, blackPoints: 1 });
  });
});

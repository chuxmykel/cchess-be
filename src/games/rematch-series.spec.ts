import { describe, expect, it } from 'vitest';

import type { Game } from './entities/game.entity.js';
import {
  SERIES_GAP_MS,
  type SeriesCandidate,
  seriesContinuedBy,
  seriesForRematchOf,
  seriesPointsAfter,
} from './rematch-series.js';

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

describe('seriesContinuedBy', () => {
  const now = new Date('2026-10-28T20:00:00Z');
  const next = {
    whiteId: 'ann',
    blackId: 'bob',
    initialSeconds: 300,
    incrementSeconds: 0,
    rated: true,
  };
  function previous(overrides: Partial<SeriesCandidate> = {}) {
    return {
      id: 'prev',
      whiteId: 'bob',
      blackId: 'ann',
      initialSeconds: 300,
      incrementSeconds: 0,
      rated: true,
      endedAt: new Date(now.getTime() - 10 * 60 * 1000),
      result: 'white',
      rematchOfId: null,
      seriesWhitePoints: 0,
      seriesBlackPoints: 0,
      ...overrides,
    } as SeriesCandidate;
  }

  it("carries on when both players' last game was against each other", () => {
    const game = previous();

    expect(seriesContinuedBy(next, game, game, now)).toEqual({
      rematchOfId: 'prev',
      // Bob won as white and is black now.
      whitePoints: 0,
      blackPoints: 1,
    });
  });

  it('keeps the points with each player when the colors stay put', () => {
    const game = previous({ whiteId: 'ann', blackId: 'bob', result: 'draw' });

    expect(seriesContinuedBy(next, game, game, now)).toEqual({
      rematchOfId: 'prev',
      whitePoints: 0.5,
      blackPoints: 0.5,
    });
  });

  it('adds to a series already going', () => {
    const game = previous({
      seriesWhitePoints: 2,
      seriesBlackPoints: 1,
      result: 'black',
    });

    // Bob had 2 as white; Ann had 1 as black, plus this win.
    expect(seriesContinuedBy(next, game, game, now)).toEqual({
      rematchOfId: 'prev',
      whitePoints: 2,
      blackPoints: 2,
    });
  });

  it('starts afresh when either played someone else since', () => {
    const together = previous();
    const withCarl = previous({ id: 'carl', whiteId: 'carl' });

    expect(seriesContinuedBy(next, together, withCarl, now)).toBeNull();
    expect(seriesContinuedBy(next, withCarl, together, now)).toBeNull();
    expect(seriesContinuedBy(next, null, together, now)).toBeNull();
  });

  it('starts afresh at another time control, or rated against casual', () => {
    const faster = previous({ initialSeconds: 180 });
    const withIncrement = previous({ incrementSeconds: 2 });
    const casual = previous({ rated: false });

    expect(seriesContinuedBy(next, faster, faster, now)).toBeNull();
    expect(
      seriesContinuedBy(next, withIncrement, withIncrement, now),
    ).toBeNull();
    expect(seriesContinuedBy(next, casual, casual, now)).toBeNull();
  });

  it('starts afresh more than an hour after their last game', () => {
    const justInTime = previous({
      endedAt: new Date(now.getTime() - SERIES_GAP_MS),
    });
    const tooLate = previous({
      endedAt: new Date(now.getTime() - SERIES_GAP_MS - 1),
    });

    expect(seriesContinuedBy(next, justInTime, justInTime, now)).not.toBeNull();
    expect(seriesContinuedBy(next, tooLate, tooLate, now)).toBeNull();
  });
});

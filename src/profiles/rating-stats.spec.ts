import { describe, expect, it } from 'vitest';

import {
  MAX_HISTORY_POINTS,
  periodStart,
  type RatingStatsGame,
  summarizeRatingStats,
  thinHistory,
} from './rating-stats.js';

const ME = 'me';
const THEM = 'them';

let nextId = 0;

/** A rated game the user played as white, ending at the given minute. */
function game(
  endedAtMinute: number,
  overrides: Partial<RatingStatsGame> = {},
): RatingStatsGame {
  nextId += 1;
  return {
    id: `game-${nextId}`,
    whiteId: ME,
    blackId: THEM,
    result: 'white',
    rated: true,
    createdAt: new Date(Date.UTC(2026, 9, 20, 10, endedAtMinute - 5)),
    endedAt: new Date(Date.UTC(2026, 9, 20, 10, endedAtMinute)),
    whiteRatingAtStart: 1500,
    blackRatingAtStart: 1500,
    whiteRatingDiff: 8,
    blackRatingDiff: -8,
    ...overrides,
  };
}

describe('summarizeRatingStats', () => {
  it("charts the rating going in, then each day's closing rating", () => {
    const first = game(10, { whiteRatingAtStart: 1500, whiteRatingDiff: 10 });
    const second = game(20, { whiteRatingAtStart: 1510, whiteRatingDiff: -6 });
    const nextDay = game(24 * 60 + 5, {
      result: 'black',
      whiteRatingAtStart: 1504,
      whiteRatingDiff: -9,
    });

    const stats = summarizeRatingStats([second, nextDay, first], ME);

    expect(stats.history).toEqual([
      { at: first.createdAt, rating: 1500 },
      { at: second.endedAt, rating: 1504 },
      { at: nextDay.endedAt, rating: 1495 },
    ]);
    // Worked out from every game: the first day's high of 1510 counts,
    // though only the day's close is charted.
    expect(stats.highest).toEqual({ at: first.endedAt, rating: 1510 });
    expect(stats.lowest).toEqual({ at: nextDay.endedAt, rating: 1495 });
    expect(stats.ratingChange).toBe(-5);
  });

  it('counts casual games in the totals but not the rating history', () => {
    const casual = game(10, {
      rated: false,
      result: 'draw',
      whiteRatingDiff: null,
    });

    const stats = summarizeRatingStats([casual], ME);

    expect(stats).toMatchObject({
      games: 1,
      wins: 0,
      draws: 1,
      losses: 0,
      timePlayedMs: 5 * 60 * 1000,
      history: [],
      highest: null,
      lowest: null,
      ratingChange: null,
    });
  });

  it('finds the best win and worst loss by the rated opponent', () => {
    const strongWin = game(10, { id: 'strong-win', blackRatingAtStart: 1700 });
    const weakWin = game(20, { blackRatingAtStart: 1400 });
    const weakLoss = game(30, {
      id: 'weak-loss',
      result: 'black',
      blackRatingAtStart: 1300,
    });
    const casualLoss = game(40, {
      rated: false,
      result: 'black',
      blackRatingAtStart: 1000,
      whiteRatingDiff: null,
    });

    const stats = summarizeRatingStats(
      [strongWin, weakWin, weakLoss, casualLoss],
      ME,
    );

    expect(stats.bestWin).toEqual({
      gameId: 'strong-win',
      opponentId: THEM,
      opponentRating: 1700,
      endedAt: strongWin.endedAt,
    });
    expect(stats.worstLoss).toMatchObject({
      gameId: 'weak-loss',
      opponentRating: 1300,
    });
  });

  it('reads results and opponents from the side the user played', () => {
    const asBlack = game(10, {
      whiteId: THEM,
      blackId: ME,
      result: 'black',
      whiteRatingAtStart: 1650,
      blackRatingAtStart: 1450,
      blackRatingDiff: 12,
    });

    const stats = summarizeRatingStats([asBlack], ME);

    expect(stats.wins).toBe(1);
    expect(stats.bestWin).toMatchObject({
      opponentId: THEM,
      opponentRating: 1650,
    });
    expect(stats.history.at(-1)?.rating).toBe(1462);
  });

  it('finds the longest win and losing streaks, broken by any other result', () => {
    const results: RatingStatsGame['result'][] = [
      'white',
      'white',
      'draw',
      'white',
      'white',
      'white',
      'black',
      'black',
      'white',
      'black',
    ];

    const stats = summarizeRatingStats(
      results.map((result, index) => game(index + 10, { result })),
      ME,
    );

    expect(stats.longestWinStreak).toBe(3);
    expect(stats.longestLosingStreak).toBe(2);
  });

  it('is empty without games', () => {
    expect(summarizeRatingStats([], ME)).toMatchObject({
      games: 0,
      history: [],
      bestWin: null,
      worstLoss: null,
      longestWinStreak: 0,
      longestLosingStreak: 0,
    });
  });
});

describe('periodStart', () => {
  const now = new Date('2026-10-27T12:00:00Z');

  it('goes back the length of the period', () => {
    expect(periodStart('1w', now)).toEqual(new Date('2026-10-20T12:00:00Z'));
    expect(periodStart('1y', now)).toEqual(new Date('2025-10-27T12:00:00Z'));
  });

  it('has no start for all time', () => {
    expect(periodStart('all', now)).toBeNull();
  });
});

describe('thinHistory', () => {
  const point = (minute: number, rating: number) => ({
    at: new Date(Date.UTC(2026, 0, 1, 0, minute)),
    rating,
  });

  it('leaves a short history alone', () => {
    const history = [point(0, 1500), point(1, 1510)];

    expect(thinHistory(history)).toBe(history);
  });

  it("keeps a long history's start, end, peaks and lows, within the limit", () => {
    const history = Array.from({ length: 10_000 }, (_, i) =>
      point(i, 1500 + Math.round(300 * Math.sin(i / 700))),
    );
    history[4321] = point(4321, 900);
    history[7777] = point(7777, 2300);

    const thinned = thinHistory(history);

    expect(thinned.length).toBeLessThanOrEqual(MAX_HISTORY_POINTS);
    expect(thinned[0]).toBe(history[0]);
    expect(thinned.at(-1)).toBe(history.at(-1));
    expect(thinned).toContain(history[4321]);
    expect(thinned).toContain(history[7777]);
    const times = thinned.map((each) => each.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("works out the period's figures before thinning", () => {
    const games = Array.from({ length: 1_000 }, (_, i) =>
      game(i, {
        result: i === 500 ? 'black' : 'white',
        whiteRatingAtStart: 1500 + i,
        whiteRatingDiff: i === 500 ? -200 : 1,
      }),
    );

    const stats = summarizeRatingStats(games, ME);

    expect(stats.history.length).toBeLessThanOrEqual(MAX_HISTORY_POINTS);
    expect(stats.highest?.rating).toBe(2500);
    expect(stats.lowest?.rating).toBe(1500);
    expect(stats.ratingChange).toBe(1000);
  });
});

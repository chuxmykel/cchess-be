import { describe, expect, it } from 'vitest';

import type { Game } from '../games/entities/game.entity.js';
import { scoreFor, summarizeActivity } from './game-stats.js';

const ME = 'me';
const THEM = 'them';

function game(overrides: Partial<Game>): Game {
  return {
    whiteId: ME,
    blackId: THEM,
    result: 'white',
    gameType: 'blitz',
    rated: true,
    endedAt: new Date('2026-10-20T10:00:00Z'),
    whiteRatingAtStart: 1500,
    blackRatingAtStart: 1500,
    whiteRatingDiff: 8,
    blackRatingDiff: -8,
    ...overrides,
  } as Game;
}

describe('scoreFor', () => {
  it("counts wins, draws and losses from the user's side", () => {
    const games = [
      game({ result: 'white' }),
      game({ whiteId: THEM, blackId: ME, result: 'white' }),
      game({ result: 'draw' }),
      game({ result: null }),
    ];

    expect(scoreFor(games, ME)).toEqual({ wins: 1, draws: 1, losses: 1 });
    expect(scoreFor(games, THEM)).toEqual({ wins: 1, draws: 1, losses: 1 });
  });
});

describe('summarizeActivity', () => {
  it('groups games by day and category, newest day first', () => {
    const activity = summarizeActivity(
      [
        game({ endedAt: new Date('2026-10-20T10:00:00Z') }),
        game({ endedAt: new Date('2026-10-21T09:00:00Z'), gameType: 'bullet' }),
        game({ endedAt: new Date('2026-10-21T08:00:00Z') }),
      ],
      ME,
    );

    expect(activity.map((day) => [day.date, day.category, day.games])).toEqual([
      ['2026-10-21', 'bullet', 1],
      ['2026-10-21', 'blitz', 1],
      ['2026-10-20', 'blitz', 1],
    ]);
  });

  it("totals the day's results and rating change, ending on the last rating", () => {
    const [day] = summarizeActivity(
      [
        game({
          endedAt: new Date('2026-10-20T12:00:00Z'),
          whiteRatingAtStart: 1508,
          whiteRatingDiff: 7,
        }),
        game({
          endedAt: new Date('2026-10-20T09:00:00Z'),
          whiteId: THEM,
          blackId: ME,
          result: 'white',
          blackRatingAtStart: 1500,
          blackRatingDiff: -8,
        }),
        game({ endedAt: new Date('2026-10-20T10:00:00Z'), result: 'draw' }),
      ],
      ME,
    );

    expect(day).toMatchObject({
      games: 3,
      wins: 1,
      draws: 1,
      losses: 1,
      ratingAfter: 1515,
      ratingDiff: 7,
    });
  });

  it('leaves the rating empty for a day of casual games', () => {
    const [day] = summarizeActivity(
      [game({ rated: false, whiteRatingDiff: null })],
      ME,
    );

    expect(day).toMatchObject({ ratingAfter: null, ratingDiff: null });
  });
});

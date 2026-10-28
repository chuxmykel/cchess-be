import { describe, expect, it } from 'vitest';

import type { Game } from './entities/game.entity.js';
import { buildPgnText, pgnClock } from './pgn.util.js';

const PLAYERS = { whiteUsername: 'ann', blackUsername: 'ben' };

function game(overrides: Partial<Game> = {}): Game {
  return {
    rated: true,
    gameType: 'blitz',
    createdAt: new Date('2026-10-28T09:30:00Z'),
    result: 'white',
    initialSeconds: 300,
    incrementSeconds: 3,
    ...overrides,
  } as Game;
}

describe('buildPgnText', () => {
  it('writes the Seven Tag Roster and the time control', () => {
    const pgn = buildPgnText(game(), PLAYERS, []);

    expect(pgn.split('\n\n')[0]).toBe(
      [
        '[Event "Rated blitz game"]',
        '[Site "cchess"]',
        '[Date "2026.10.28"]',
        '[Round "-"]',
        '[White "ann"]',
        '[Black "ben"]',
        '[Result "1-0"]',
        '[TimeControl "300+3"]',
      ].join('\n'),
    );
  });

  it("follows each move with the mover's clock, numbering black's moves too", () => {
    const pgn = buildPgnText(game(), PLAYERS, [
      { san: 'e4', clockAfterMs: 300_000 },
      { san: 'e5', clockAfterMs: 298_400 },
      { san: 'Qh5', clockAfterMs: 301_000 },
    ]);

    expect(pgn.split('\n\n')[1]).toBe(
      [
        '1. e4 { [%clk 0:05:00] } 1... e5 { [%clk 0:04:58] } 2. Qh5 { [%clk 0:05:01] }',
        '1-0',
      ].join('\n'),
    );
  });

  it('keeps every movetext line under 80 characters, never splitting a comment', () => {
    const moves = Array.from({ length: 40 }, (_, ply) => ({
      san: ply % 2 === 0 ? 'Nf3' : 'Nf6',
      clockAfterMs: 120_000,
    }));

    const movetext = buildPgnText(game(), PLAYERS, moves).split('\n\n')[1];

    for (const line of movetext.split('\n')) {
      expect(line.length).toBeLessThan(80);
      expect(line.split('{').length).toBe(line.split('}').length);
    }
  });

  it('marks a game still in progress with *', () => {
    const pgn = buildPgnText(game({ result: null }), PLAYERS, []);

    expect(pgn).toContain('[Result "*"]');
    expect(pgn.endsWith('\n\n*')).toBe(true);
  });
});

describe('pgnClock', () => {
  it('reads hours, minutes and seconds, rounded down', () => {
    expect(pgnClock(3_725_900)).toBe('1:02:05');
    expect(pgnClock(999)).toBe('0:00:00');
    expect(pgnClock(-50)).toBe('0:00:00');
  });
});

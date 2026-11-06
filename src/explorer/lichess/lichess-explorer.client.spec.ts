import { describe, expect, it } from 'vitest';

import {
  normalizeCastling,
  trimLichessReply,
} from './lichess-explorer.client.js';

describe('trimLichessReply', () => {
  it('keeps the totals and each move’s results, nothing else', () => {
    expect(
      trimLichessReply({
        white: 10,
        draws: 5,
        black: 3,
        moves: [
          {
            uci: 'e2e4',
            san: 'e4',
            white: 6,
            draws: 3,
            black: 1,
            averageRating: 2400,
            game: null,
          } as never,
        ],
      }),
    ).toEqual({
      white: 10,
      draws: 5,
      black: 3,
      moves: [{ uci: 'e2e4', san: 'e4', white: 6, draws: 3, black: 1 }],
    });
  });

  it('reads a reply with nothing in it as no games', () => {
    expect(trimLichessReply({})).toEqual({
      white: 0,
      draws: 0,
      black: 0,
      moves: [],
    });
  });
});

describe('normalizeCastling', () => {
  it('writes castling as the king’s own move', () => {
    expect(normalizeCastling({ uci: 'e1h1', san: 'O-O' })).toBe('e1g1');
    expect(normalizeCastling({ uci: 'e8a8', san: 'O-O-O+' })).toBe('e8c8');
    expect(normalizeCastling({ uci: 'e1g1', san: 'O-O' })).toBe('e1g1');
  });

  it('leaves a king’s other moves alone', () => {
    expect(normalizeCastling({ uci: 'e1h1', san: 'Kxh1' })).toBe('e1h1');
  });
});

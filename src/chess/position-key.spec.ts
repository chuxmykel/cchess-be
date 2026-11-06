import { describe, expect, it } from 'vitest';

import { positionKey } from './position-key.js';

describe('positionKey', () => {
  it('keeps the position and drops the move counters', () => {
    expect(
      positionKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'),
    ).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -');
  });

  it('gives a transposition the same key', () => {
    // 1.Nf3 Nf6 2.c4 and 1.c4 Nf6 2.Nf3, with different counters.
    const one =
      'rnbqkb1r/pppppppp/5n2/8/2P5/5N2/PP1PPPPP/RNBQKB1R b KQkq - 0 2';
    const other =
      'rnbqkb1r/pppppppp/5n2/8/2P5/5N2/PP1PPPPP/RNBQKB1R b KQkq - 2 2';
    expect(positionKey(one)).toBe(positionKey(other));
  });
});

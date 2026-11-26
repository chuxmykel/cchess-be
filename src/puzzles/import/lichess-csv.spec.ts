import { describe, expect, it } from 'vitest';

import { IMPORT_FILTER, makeSelector, parseRow } from './lichess-csv.js';

const ROW =
  '00sHx,q3k1nr/1pp1nQpp/3p4/1P2p3/4P3/B1PP1b2/B5PP/5K2 b k - 0 17,e8d7 a2e6 d7d8 f7f8,1760,80,83,72,mate mateIn2 middlegame short,https://lichess.org/yyznGmXs/black#34,Italian_Game Italian_Game_Classical_Variation';

describe('parseRow', () => {
  it('reads a puzzle from its row', () => {
    expect(parseRow(ROW)).toEqual({
      id: '00sHx',
      fen: 'q3k1nr/1pp1nQpp/3p4/1P2p3/4P3/B1PP1b2/B5PP/5K2 b k - 0 17',
      moves: 'e8d7 a2e6 d7d8 f7f8',
      rating: 1760,
      ratingDeviation: 80,
      popularity: 83,
      nbPlays: 72,
      themes: ['mate', 'mateIn2', 'middlegame', 'short'],
    });
  });

  it("passes over the header, and a row that isn't a puzzle", () => {
    expect(
      parseRow(
        'PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags',
      ),
    ).toBeNull();
    expect(
      parseRow('00sHx,not a fen,e8d7 a2e6,1760,80,83,72,mate,,'),
    ).toBeNull();
    expect(parseRow(ROW.replace('e8d7 a2e6', 'e8d7 z9z9'))).toBeNull();
  });
});

describe('makeSelector', () => {
  const row = (rating: number, overrides = {}) => ({
    ...parseRow(ROW)!,
    rating,
    popularity: 95,
    nbPlays: 5000,
    ...overrides,
  });

  it('keeps well-liked, well-played puzzles in the ratings range', () => {
    const keep = makeSelector(1000);
    expect(keep(row(1500))).toBe(true);
    expect(
      keep(row(1500, { popularity: IMPORT_FILTER.minPopularity - 1 })),
    ).toBe(false);
    expect(keep(row(1500, { nbPlays: 10 }))).toBe(false);
    expect(keep(row(IMPORT_FILTER.maxRating + 50))).toBe(false);
  });

  it('caps each rating band at its share, and stops at the limit', () => {
    // 22 bands of 100 from 600 to 2800: two puzzles a band at a limit of 44.
    const keep = makeSelector(44);
    expect([keep(row(1500)), keep(row(1520)), keep(row(1550))]).toEqual([
      true,
      true,
      false,
    ]);
    expect(keep(row(1650))).toBe(true);
  });
});

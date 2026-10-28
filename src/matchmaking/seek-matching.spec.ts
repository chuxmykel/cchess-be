import { describe, expect, it } from 'vitest';

import {
  canPair,
  findBestOpponent,
  isValidRatingRange,
  type SeekCriteria,
} from './seek-matching.js';

function makeSeek(overrides: Partial<SeekCriteria> = {}): SeekCriteria {
  return {
    userId: 'seeker',
    initialSeconds: 300,
    incrementSeconds: 0,
    rated: true,
    rating: 1500,
    ratingRange: null,
    ...overrides,
  };
}

describe('canPair', () => {
  it('pairs two seeks for the same time control and rated choice', () => {
    expect(canPair(makeSeek(), makeSeek({ userId: 'opponent' }))).toBe(true);
  });

  it('never pairs a player with themselves', () => {
    expect(canPair(makeSeek(), makeSeek())).toBe(false);
  });

  it('keeps different time controls apart', () => {
    const opponent = makeSeek({ userId: 'opponent', incrementSeconds: 3 });
    expect(canPair(makeSeek(), opponent)).toBe(false);
  });

  it('keeps rated and casual seeks apart', () => {
    const opponent = makeSeek({ userId: 'opponent', rated: false });
    expect(canPair(makeSeek(), opponent)).toBe(false);
  });

  it('accepts any rating gap when neither seek sets a range', () => {
    const opponent = makeSeek({ userId: 'opponent', rating: 2400 });
    expect(canPair(makeSeek({ rating: 900 }), opponent)).toBe(true);
  });

  it("needs each player's rating inside the other's range", () => {
    const seeker = makeSeek({
      rating: 1500,
      ratingRange: { below: 0, above: 500 },
    });

    expect(
      canPair(seeker, makeSeek({ userId: 'stronger', rating: 1700 })),
    ).toBe(true);
    expect(canPair(seeker, makeSeek({ userId: 'weaker', rating: 1499 }))).toBe(
      false,
    );
    expect(
      canPair(
        seeker,
        makeSeek({
          userId: 'picky',
          rating: 1700,
          ratingRange: { below: 100, above: 100 },
        }),
      ),
    ).toBe(false);
  });

  it('includes both ends of a range', () => {
    const seeker = makeSeek({ ratingRange: { below: 200, above: 200 } });

    expect(canPair(seeker, makeSeek({ userId: 'low', rating: 1300 }))).toBe(
      true,
    );
    expect(canPair(seeker, makeSeek({ userId: 'high', rating: 1700 }))).toBe(
      true,
    );
  });

  it('leaves a side with no limit open', () => {
    const seeker = makeSeek({
      rating: 1500,
      ratingRange: { below: null, above: 100 },
    });

    expect(canPair(seeker, makeSeek({ userId: 'low', rating: 600 }))).toBe(
      true,
    );
    expect(canPair(seeker, makeSeek({ userId: 'high', rating: 1650 }))).toBe(
      false,
    );
  });

  it('ignores ranges for guests, who have no rating', () => {
    const casualSeeker = makeSeek({
      rated: false,
      ratingRange: { below: 0, above: 0 },
    });
    const guest = makeSeek({ userId: 'guest', rated: false, rating: null });

    expect(canPair(casualSeeker, guest)).toBe(true);
  });
});

describe('findBestOpponent', () => {
  it('picks the closest rating among the seeks that pair', () => {
    const waiting = [
      makeSeek({ userId: 'far', rating: 1900 }),
      makeSeek({ userId: 'casual', rated: false, rating: 1500 }),
      makeSeek({ userId: 'close', rating: 1450 }),
    ];

    expect(findBestOpponent(makeSeek(), waiting)?.userId).toBe('close');
  });

  it('picks the earliest seek on a tie', () => {
    const waiting = [
      makeSeek({ userId: 'first', rating: 1400 }),
      makeSeek({ userId: 'second', rating: 1600 }),
    ];

    expect(findBestOpponent(makeSeek(), waiting)?.userId).toBe('first');
  });

  it('finds nobody when no seek pairs', () => {
    const waiting = [makeSeek({ userId: 'other', initialSeconds: 180 })];

    expect(findBestOpponent(makeSeek(), waiting)).toBeUndefined();
  });
});

describe('isValidRatingRange', () => {
  it('accepts whole numbers from 0 to 1000 on each side', () => {
    expect(isValidRatingRange({ below: 0, above: 1000 })).toBe(true);
  });

  it('accepts a side with no limit', () => {
    expect(isValidRatingRange({ below: null, above: 300 })).toBe(true);
  });

  it('rejects negative, fractional and oversized deltas', () => {
    expect(isValidRatingRange({ below: -1, above: 100 })).toBe(false);
    expect(isValidRatingRange({ below: 100, above: 50.5 })).toBe(false);
    expect(isValidRatingRange({ below: 100, above: 1001 })).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import type { ReviewScore } from '../games/entities/game-review.entity.js';
import {
  type GameForBadges,
  gameBadges,
  isGamesMilestone,
  moveTimes,
  type PlayedMove,
  ratingLinesCrossed,
  reviewBadges,
  type ReviewForBadges,
} from './badge-rules.js';

const MIDGAME =
  'r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 4 4';
const ENDGAME = '4k3/8/8/8/8/8/8/R3K3 w - - 0 40';

// A move: white's on even indexes.
const move = (i: number, over: Partial<PlayedMove> = {}): PlayedMove => ({
  color: i % 2 === 0 ? 'w' : 'b',
  san: `M${i}`,
  promotion: null,
  fenAfter: MIDGAME,
  clockAfterMs: 100_000,
  ...over,
});
const moves = (
  count: number,
  over: (i: number) => Partial<PlayedMove> = () => ({}),
) => Array.from({ length: count }, (_, i) => move(i, over(i)));

const game = (over: Partial<GameForBadges> = {}): GameForBadges => ({
  side: 'w',
  result: 'white',
  moves: moves(3),
  clock: null,
  bullet: false,
  ratings: { w: 1500, b: 1500 },
  ...over,
});

const cp = (value: number): ReviewScore => ({ kind: 'cp', cp: value });
// A review: scores after each move from white's side (the start level).
const review = (
  after: number[],
  over: Partial<ReviewForBadges> & {
    classOf?: (i: number) => string;
    factsOf?: (i: number) => string[];
  } = {},
): ReviewForBadges => ({
  scores: [cp(0), ...after.map(cp)],
  classes: after.map((_, i) => ({
    moveClass: over.classOf?.(i) ?? 'good',
    facts: over.factsOf?.(i) ?? [],
  })),
  accuracy: over.accuracy ?? 90,
});
const scored = (after: number[]) => game({ moves: moves(after.length) });

describe('gameBadges', () => {
  it('marks short and long wins', () => {
    expect(gameBadges(game({ moves: moves(40) }))).toContain('miniature');
    expect(gameBadges(game({ moves: moves(42) }))).not.toContain('miniature');
    expect(gameBadges(game({ moves: moves(120) }))).toContain('marathon');
    expect(gameBadges(game({ moves: moves(40), result: 'draw' }))).toEqual([]);
  });

  it('tells the mates apart, the side giving it', () => {
    const mating = (san: string, fenAfter: string) =>
      game({ moves: [move(0), move(1), move(2, { san, fenAfter })] });
    const smothered = mating('Nf7#', '6rk/5Npp/8/8/8/8/8/6K1 b - - 1 1');
    expect(gameBadges(smothered)).toContain('smotheredMate');
    expect(gameBadges({ ...smothered, side: 'b' })).not.toContain(
      'smotheredMate',
    );
    expect(
      gameBadges(mating('Rd8#', '3R2k1/5ppp/8/8/8/8/8/6K1 b - - 1 1')),
    ).toContain('backRankMate');
    expect(gameBadges(mating('g7#', MIDGAME))).toContain('pawnMate');
  });

  it("marks a king's march, an underpromotion, a fortress", () => {
    const marched = game({
      moves: [move(0, { fenAfter: '4k3/8/8/4K3/8/8/8/8 b - - 0 40' })],
    });
    expect(gameBadges(marched)).toContain('kingsMarch');
    expect(
      gameBadges(game({ moves: [move(0, { promotion: 'n', san: 'e8=N' })] })),
    ).toContain('underpromotion');
    expect(
      gameBadges(game({ moves: [move(0, { promotion: 'q', san: 'e8=Q' })] })),
    ).not.toContain('underpromotion');
    const pieceDown = game({
      result: 'draw',
      moves: [move(0, { fenAfter: '4k3/8/8/8/8/8/3n4/4K3 w - - 0 60' })],
    });
    expect(gameBadges(pieceDown)).toContain('fortress');
    expect(gameBadges({ ...pieceDown, side: 'b' })).not.toContain('fortress');
  });

  it('marks a photo finish in a live game, and a giant killed', () => {
    const close = game({
      clock: { initialMs: 180_000, incrementMs: 0 },
      moves: [move(0), move(1), move(2, { clockAfterMs: 3_000 })],
    });
    expect(gameBadges(close)).toContain('photoFinish');
    expect(gameBadges({ ...close, clock: null })).not.toContain('photoFinish');
    expect(gameBadges(game({ ratings: { w: 1500, b: 1720 } }))).toContain(
      'giantKiller',
    );
    expect(gameBadges(game({ ratings: { w: 1500, b: 1650 } }))).not.toContain(
      'giantKiller',
    );
    expect(gameBadges(game({ ratings: { w: 1500, b: null } }))).not.toContain(
      'giantKiller',
    );
  });
});

describe('reviewBadges', () => {
  it('reads how it went off the scores', () => {
    const swindled = [0, -900, -900, 500];
    expect(reviewBadges(scored(swindled), review(swindled))).toContain(
      'swindle',
    );
    const comeback = [0, -300, -300, 400];
    expect(reviewBadges(scored(comeback), review(comeback))).toContain(
      'comeback',
    );
    expect(
      reviewBadges({ ...scored(comeback), result: 'draw' }, review(comeback)),
    ).toContain('heldDraw');
    const steady = [0, 50, 100, 300];
    expect(reviewBadges(scored(steady), review(steady))).toContain(
      'neverInDoubt',
    );
    const swings = [400, -400, 400, -400];
    expect(
      reviewBadges({ ...scored(swings), result: 'draw' }, review(swings)),
    ).toContain('rollercoaster');
  });

  it('marks an endgame won from level', () => {
    const after = [0, 0, 50, 900];
    const endgame = game({
      moves: moves(4, (i) => (i >= 1 ? { fenAfter: ENDGAME } : {})),
    });
    expect(reviewBadges(endgame, review(after))).toContain('endgameGrind');
  });

  it("reads brilliance and tactics off the classifier's word", () => {
    const after = [0, 0, 0];
    const g = scored(after);
    expect(
      reviewBadges(
        g,
        review(after, { classOf: (i) => (i === 2 ? 'brilliant' : 'good') }),
      ),
    ).toEqual(expect.arrayContaining(['brilliancy', 'sacrifice']));
    expect(
      reviewBadges(
        g,
        review(after, { factsOf: (i) => (i === 0 ? ['sacrifice:queen'] : []) }),
      ),
    ).toEqual(expect.arrayContaining(['sacrifice', 'queenSacrifice']));
    const forks = [0, 0, 0, 0, 0, 0];
    expect(
      reviewBadges(
        scored(forks),
        review(forks, { factsOf: (i) => (i % 2 === 0 ? ['fork:knight'] : []) }),
      ),
    ).toContain('forkFrenzy');
  });

  it('marks clean, flawless and book-learnt games', () => {
    const long = Array.from({ length: 50 }, () => 0);
    const g = { ...scored(long), result: 'draw' as const };
    expect(reviewBadges(g, review(long, { accuracy: 92 }))).toContain('clean');
    expect(
      reviewBadges(g, review(long, { accuracy: 96, classOf: () => 'best' })),
    ).toContain('flawless');
    expect(
      reviewBadges(
        g,
        review(long, {
          accuracy: 96,
          classOf: (i) => (i === 4 ? 'inaccuracy' : 'best'),
        }),
      ),
    ).not.toContain('flawless');
    expect(
      reviewBadges(
        g,
        review(long, { classOf: (i) => (i < 24 ? 'book' : 'good') }),
      ),
    ).toContain('bookWorm');
  });

  it('reads the clock: a deep think that found the best move, bullet precision', () => {
    const after = [0, 0, 0];
    const thought = game({
      result: 'draw',
      clock: { initialMs: 180_000, incrementMs: 0 },
      moves: [
        move(0, { clockAfterMs: 180_000 }),
        move(1, { clockAfterMs: 175_000 }),
        move(2, { clockAfterMs: 110_000 }),
      ],
    });
    expect(
      reviewBadges(thought, review(after, { classOf: () => 'best' })),
    ).toContain('deepThinker');
    expect(reviewBadges(thought, review(after))).not.toContain('deepThinker');

    const forty = Array.from({ length: 40 }, () => 0);
    const bullet = game({
      result: 'draw',
      bullet: true,
      clock: { initialMs: 60_000, incrementMs: 0 },
      moves: moves(40),
    });
    expect(reviewBadges(bullet, review(forty, { accuracy: 88 }))).toContain(
      'lightningPrecision',
    );
    expect(
      reviewBadges(
        { ...bullet, bullet: false },
        review(forty, { accuracy: 88 }),
      ),
    ).not.toContain('lightningPrecision');
  });
});

describe('milestones', () => {
  it('finds the rating lines crossed going up', () => {
    expect(ratingLinesCrossed(1500, 1610)).toEqual([1600]);
    expect(ratingLinesCrossed(1620, 1810)).toEqual([1700, 1800]);
    expect(ratingLinesCrossed(1599, 1600)).toEqual([1600]);
    expect(ratingLinesCrossed(1600, 1650)).toEqual([]);
  });

  it('knows the games-played milestones', () => {
    expect([9, 10, 11, 100, 1000, 500].map(isGamesMilestone)).toEqual([
      false,
      true,
      false,
      true,
      true,
      false,
    ]);
  });

  it("times each move, a side's first none", () => {
    expect(
      moveTimes(
        [
          move(0, { clockAfterMs: 60_000 }),
          move(1, { clockAfterMs: 60_000 }),
          move(2, { clockAfterMs: 50_000 }),
        ],
        { initialMs: 60_000, incrementMs: 2_000 },
      ),
    ).toEqual([0, 0, 12_000]);
  });
});

import { describe, expect, it } from 'vitest';

import { STARTING_FEN, type Game } from './entities/game.entity.js';
import { remainingTimesAt } from './clock.js';

const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_E4_E5 =
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const LAST_MOVE_AT = new Date('2026-10-30T10:00:00Z');
const TEN_SECONDS_LATER = LAST_MOVE_AT.getTime() + 10_000;

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    status: 'active',
    fen: AFTER_E4_E5,
    turn: 'w',
    whiteTimeRemainingMs: 60_000,
    blackTimeRemainingMs: 50_000,
    lastMoveAt: LAST_MOVE_AT,
    createdAt: new Date('2026-10-30T09:59:00Z'),
    ...overrides,
  } as Game;
}

describe('remainingTimesAt', () => {
  it("counts down the side to move's clock since the last move", () => {
    expect(remainingTimesAt(makeGame(), TEN_SECONDS_LATER)).toEqual({
      whiteTimeRemainingMs: 50_000,
      blackTimeRemainingMs: 50_000,
    });
  });

  it("runs black's clock on black's turn", () => {
    const game = makeGame({
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
      turn: 'b',
    });

    expect(remainingTimesAt(game, TEN_SECONDS_LATER)).toEqual({
      whiteTimeRemainingMs: 60_000,
      blackTimeRemainingMs: 40_000,
    });
  });

  it('stops at zero', () => {
    const game = makeGame({ whiteTimeRemainingMs: 5_000 });

    expect(remainingTimesAt(game, TEN_SECONDS_LATER).whiteTimeRemainingMs).toBe(
      0,
    );
  });

  it('leaves the clocks alone until both sides have moved', () => {
    const beforeAnyMove = makeGame({ fen: STARTING_FEN, lastMoveAt: null });
    const afterWhitesFirst = makeGame({ fen: AFTER_E4, turn: 'b' });

    expect(remainingTimesAt(beforeAnyMove, TEN_SECONDS_LATER)).toEqual({
      whiteTimeRemainingMs: 60_000,
      blackTimeRemainingMs: 50_000,
    });
    expect(remainingTimesAt(afterWhitesFirst, TEN_SECONDS_LATER)).toEqual({
      whiteTimeRemainingMs: 60_000,
      blackTimeRemainingMs: 50_000,
    });
  });

  it('leaves a finished game as it ended', () => {
    const game = makeGame({ status: 'completed' });

    expect(remainingTimesAt(game, TEN_SECONDS_LATER)).toEqual({
      whiteTimeRemainingMs: 60_000,
      blackTimeRemainingMs: 50_000,
    });
  });
});

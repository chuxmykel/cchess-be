import { describe, expect, it } from 'vitest';

import { STARTING_FEN, type Game } from './entities/game.entity.js';
import { clockForMove, remainingTimesAt } from './clock.js';

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

  it("runs a daily game's clock from the start, its first moves timed like any other", () => {
    const createdAt = new Date('2026-10-30T09:00:00Z');
    const game = makeGame({
      gameType: 'daily',
      fen: STARTING_FEN,
      lastMoveAt: null,
      createdAt,
      whiteTimeRemainingMs: 86_400_000,
      blackTimeRemainingMs: 86_400_000,
    });

    expect(remainingTimesAt(game, createdAt.getTime() + 3_600_000)).toEqual({
      whiteTimeRemainingMs: 82_800_000,
      blackTimeRemainingMs: 86_400_000,
    });
  });
});

describe('clockForMove', () => {
  const blitz = { initialSeconds: 60, incrementSeconds: 2 };

  it('charges the time since the last move, then adds the increment', () => {
    const game = makeGame(blitz);

    expect(clockForMove(game, 'w', TEN_SECONDS_LATER)).toEqual({
      status: 'ok',
      remainingAfter: 52_000,
    });
  });

  it("charges a pre-move's fixed charge instead of the time since", () => {
    const game = makeGame(blitz);

    expect(clockForMove(game, 'w', TEN_SECONDS_LATER, 100)).toEqual({
      status: 'ok',
      remainingAfter: 61_900,
    });
  });

  it("neither charges nor adds the increment to a side's first move", () => {
    const beforeAnyMove = makeGame({
      ...blitz,
      fen: STARTING_FEN,
      lastMoveAt: null,
      createdAt: LAST_MOVE_AT,
    });
    const afterWhitesFirst = makeGame({ ...blitz, fen: AFTER_E4, turn: 'b' });

    expect(clockForMove(beforeAnyMove, 'w', TEN_SECONDS_LATER)).toEqual({
      status: 'ok',
      remainingAfter: 60_000,
    });
    expect(clockForMove(afterWhitesFirst, 'b', TEN_SECONDS_LATER)).toEqual({
      status: 'ok',
      remainingAfter: 50_000,
    });
  });

  it('refuses a first move after its deadline', () => {
    const game = makeGame({
      ...blitz,
      fen: STARTING_FEN,
      lastMoveAt: null,
      createdAt: LAST_MOVE_AT,
    });

    expect(clockForMove(game, 'w', LAST_MOVE_AT.getTime() + 31_000)).toEqual({
      status: 'late-first-move',
    });
  });

  it('flags a move made once the time has run out, increment or not', () => {
    const game = makeGame({ ...blitz, whiteTimeRemainingMs: 10_000 });

    expect(clockForMove(game, 'w', TEN_SECONDS_LATER)).toEqual({
      status: 'flagged',
    });
    expect(clockForMove(game, 'w', TEN_SECONDS_LATER + 1)).toEqual({
      status: 'flagged',
    });
  });

  it("resets a daily game's clock to the full days with every move, first moves included", () => {
    const threeDaysMs = 3 * 86_400_000;
    const daily = {
      gameType: 'daily' as const,
      initialSeconds: threeDaysMs / 1000,
      incrementSeconds: 0,
      whiteTimeRemainingMs: threeDaysMs,
      blackTimeRemainingMs: threeDaysMs,
    };
    const firstMove = makeGame({
      ...daily,
      fen: STARTING_FEN,
      lastMoveAt: null,
      createdAt: LAST_MOVE_AT,
    });
    const later = makeGame(daily);
    const aDayOn = LAST_MOVE_AT.getTime() + 86_400_000;

    expect(clockForMove(firstMove, 'w', aDayOn)).toEqual({
      status: 'ok',
      remainingAfter: threeDaysMs,
    });
    expect(clockForMove(later, 'w', aDayOn)).toEqual({
      status: 'ok',
      remainingAfter: threeDaysMs,
    });
  });

  it('flags a daily move made after its days have run out', () => {
    const game = makeGame({
      gameType: 'daily',
      initialSeconds: 86_400,
      incrementSeconds: 0,
      whiteTimeRemainingMs: 86_400_000,
    });

    expect(
      clockForMove(game, 'w', LAST_MOVE_AT.getTime() + 86_400_001),
    ).toEqual({ status: 'flagged' });
  });

  it("refuses a daily game's first move after its days", () => {
    const game = makeGame({
      gameType: 'daily',
      initialSeconds: 86_400,
      incrementSeconds: 0,
      fen: STARTING_FEN,
      lastMoveAt: null,
      createdAt: LAST_MOVE_AT,
    });

    expect(
      clockForMove(game, 'w', LAST_MOVE_AT.getTime() + 86_400_001),
    ).toEqual({ status: 'late-first-move' });
  });
});

import { afterEach, describe, expect, it } from 'vitest';

import { STARTING_FEN, type Game } from './entities/game.entity.js';
import { firstMoveDeadline, isAwaitingFirstMove } from './first-move.js';

const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_E4_E5 =
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const CREATED_AT = new Date('2026-10-27T10:00:00Z');
const WHITE_MOVED_AT = new Date('2026-10-27T10:00:05Z');

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    status: 'active',
    fen: STARTING_FEN,
    createdAt: CREATED_AT,
    lastMoveAt: null,
    ...overrides,
  } as Game;
}

describe('first move', () => {
  afterEach(() => {
    delete process.env.GAME_FIRST_MOVE_TIMEOUT_MS;
  });

  it('gives white 30 seconds from the start of the game', () => {
    expect(firstMoveDeadline(makeGame())).toEqual(
      new Date('2026-10-27T10:00:30Z'),
    );
  });

  it("gives black 30 seconds from white's first move", () => {
    const game = makeGame({ fen: AFTER_E4, lastMoveAt: WHITE_MOVED_AT });

    expect(firstMoveDeadline(game)).toEqual(new Date('2026-10-27T10:00:35Z'));
  });

  it('stops once both sides have moved', () => {
    const game = makeGame({ fen: AFTER_E4_E5, lastMoveAt: WHITE_MOVED_AT });

    expect(isAwaitingFirstMove(game)).toBe(false);
    expect(firstMoveDeadline(game)).toBeNull();
  });

  it('has no deadline once the game is over', () => {
    expect(firstMoveDeadline(makeGame({ status: 'aborted' }))).toBeNull();
  });

  it('takes the timeout from GAME_FIRST_MOVE_TIMEOUT_MS', () => {
    process.env.GAME_FIRST_MOVE_TIMEOUT_MS = '1000';

    expect(firstMoveDeadline(makeGame())).toEqual(
      new Date('2026-10-27T10:00:01Z'),
    );
  });
});

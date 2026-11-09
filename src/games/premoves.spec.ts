import { describe, expect, it } from 'vitest';

import { STARTING_FEN, type Game } from './entities/game.entity.js';
import {
  type Premove,
  PREMOVE_CHARGE_MS,
  premoveRequest,
  queuedPremoveAction,
} from './premoves.js';

const AFTER_E4_E5 =
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const WHITES_PREMOVE: Premove = { color: 'w', from: 'g1', to: 'f3' };

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    status: 'active',
    gameType: 'blitz',
    fen: AFTER_E4_E5,
    turn: 'w',
    whiteTimeRemainingMs: 60_000,
    blackTimeRemainingMs: 60_000,
    ...overrides,
  } as Game;
}

describe('premoveRequest', () => {
  it("queues a pre-move sent on the opponent's turn", () => {
    expect(premoveRequest(makeGame({ turn: 'b' }), 'w')).toBe('queue');
  });

  it("plays a pre-move sent on the player's own turn as a move", () => {
    expect(premoveRequest(makeGame(), 'w')).toBe('move');
  });

  it('refuses a pre-move in a daily game', () => {
    expect(premoveRequest(makeGame({ gameType: 'daily' }), 'w')).toBe(
      'refused-daily',
    );
  });
});

describe('queuedPremoveAction', () => {
  it("plays a pre-move once it's its player's turn", () => {
    expect(queuedPremoveAction(WHITES_PREMOVE, makeGame())).toBe('play');
  });

  it("waits while it's still the opponent's turn", () => {
    expect(queuedPremoveAction(WHITES_PREMOVE, makeGame({ turn: 'b' }))).toBe(
      'wait',
    );
  });

  it('waits once the game is over', () => {
    const game = makeGame({ status: 'completed' });

    expect(queuedPremoveAction(WHITES_PREMOVE, game)).toBe('wait');
  });

  it(`drops a pre-move its player hasn't ${PREMOVE_CHARGE_MS}ms left for`, () => {
    const atCharge = makeGame({ whiteTimeRemainingMs: PREMOVE_CHARGE_MS });
    const justOver = makeGame({ whiteTimeRemainingMs: PREMOVE_CHARGE_MS + 1 });

    expect(queuedPremoveAction(WHITES_PREMOVE, atCharge)).toBe('drop');
    expect(queuedPremoveAction(WHITES_PREMOVE, justOver)).toBe('play');
  });

  it("plays a pre-move before either side's first move, whatever the clock", () => {
    const game = makeGame({ fen: STARTING_FEN, whiteTimeRemainingMs: 0 });

    expect(queuedPremoveAction(WHITES_PREMOVE, game)).toBe('play');
  });
});

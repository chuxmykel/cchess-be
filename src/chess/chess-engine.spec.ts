import { describe, expect, it } from 'vitest';

import { ServerChessEngine } from './chess-engine.js';

describe('ServerChessEngine', () => {
  it('applies a legal pawn move', () => {
    const engine = new ServerChessEngine();
    const outcome = engine.attemptMove('e2', 'e4');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.move.san).toBe('e4');
      expect(outcome.move.isCapture).toBe(false);
    }
    expect(engine.getTurn()).toBe('b');
  });

  it('rejects an illegal move', () => {
    const engine = new ServerChessEngine();
    expect(engine.attemptMove('e2', 'e5').status).toBe('illegal');
  });

  it('requires a promotion piece when promoting', () => {
    // White pawn one step from promotion, black king far away, legal position.
    const engine = new ServerChessEngine('8/P6k/8/8/8/8/7K/8 w - - 0 1');
    expect(engine.attemptMove('a7', 'a8').status).toBe(
      'needs-promotion-choice',
    );
    const outcome = engine.attemptMove('a7', 'a8', 'q');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.move.isPromotion).toBe(true);
      expect(outcome.move.promotion).toBe('q');
    }
  });

  it("detects checkmate (fool's mate)", () => {
    const engine = new ServerChessEngine();
    engine.attemptMove('f2', 'f3');
    engine.attemptMove('e7', 'e5');
    engine.attemptMove('g2', 'g4');
    const outcome = engine.attemptMove('d8', 'h4');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.move.isCheckmate).toBe(true);
    }
    expect(engine.getGameOverReason()).toBe('checkmate');
    expect(engine.isGameOver()).toBe(true);
  });

  it('detects stalemate', () => {
    const engine = new ServerChessEngine('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(engine.getGameOverReason()).toBe('stalemate');
    expect(engine.isCheck()).toBe(false);
  });

  it('replays castling correctly', () => {
    const engine = new ServerChessEngine(
      'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
    );
    const outcome = engine.attemptMove('e1', 'g1');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.move.isKingSideCastle).toBe(true);
    }
  });
});

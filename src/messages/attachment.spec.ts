import { describe, expect, it } from 'vitest';

import { AttachmentError, parseAttachment } from './attachment.js';

const GAME_ID = '0b7a9d2e-5f3c-4c1a-9e8b-1d2c3b4a5f6e';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('parseAttachment', () => {
  it('takes a shared game by its id', () => {
    expect(parseAttachment({ kind: 'game', gameId: GAME_ID })).toEqual({
      kind: 'game',
      gameId: GAME_ID,
    });
  });

  it('takes a shared position by its FEN', () => {
    expect(parseAttachment({ kind: 'position', fen: AFTER_E4 })).toEqual({
      kind: 'position',
      fen: AFTER_E4,
    });
  });

  it('keeps only its own fields', () => {
    expect(
      parseAttachment({ kind: 'game', gameId: GAME_ID, fen: AFTER_E4, x: 1 }),
    ).toEqual({ kind: 'game', gameId: GAME_ID });
  });

  it('refuses a game with no id, or one that is no id', () => {
    for (const gameId of [undefined, 42, 'not-a-uuid']) {
      expect(() => parseAttachment({ kind: 'game', gameId })).toThrow(
        AttachmentError,
      );
    }
  });

  it('refuses something that is no position', () => {
    for (const fen of [
      undefined,
      'not a fen',
      `${AFTER_E4}${' '.repeat(100)}x`,
    ]) {
      expect(() => parseAttachment({ kind: 'position', fen })).toThrow(
        AttachmentError,
      );
    }
  });

  it('refuses anything else', () => {
    for (const raw of [null, 'game', [], { kind: 'move' }]) {
      expect(() => parseAttachment(raw)).toThrow(AttachmentError);
    }
  });
});

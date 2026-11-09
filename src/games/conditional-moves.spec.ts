import { describe, expect, it } from 'vitest';

import {
  branchFor,
  conditionalStep,
  linesOf,
  mergeLines,
  trimLine,
} from './conditional-moves.js';

describe('conditional moves', () => {
  it('builds a tree from lines, sharing what they start with', () => {
    const tree = mergeLines(
      [],
      [
        ['e7e5', 'g1f3', 'b8c6', 'f1b5'],
        ['e7e5', 'g1f3', 'd7d6', 'd2d4'],
        ['c7c5', 'g1f3'],
      ],
    );

    expect(tree).toEqual([
      {
        opponent: 'e7e5',
        reply: 'g1f3',
        next: [
          { opponent: 'b8c6', reply: 'f1b5', next: [] },
          { opponent: 'd7d6', reply: 'd2d4', next: [] },
        ],
      },
      { opponent: 'c7c5', reply: 'g1f3', next: [] },
    ]);
    expect(linesOf(tree)).toEqual([
      ['e7e5', 'g1f3', 'b8c6', 'f1b5'],
      ['e7e5', 'g1f3', 'd7d6', 'd2d4'],
      ['c7c5', 'g1f3'],
    ]);
  });

  it('adds lines to a tree without changing it', () => {
    const tree = mergeLines([], [['e7e5', 'g1f3']]);

    const more = mergeLines(tree, [['e7e5', 'g1f3', 'b8c6', 'f1c4']]);

    expect(tree[0].next).toEqual([]);
    expect(linesOf(more)).toEqual([['e7e5', 'g1f3', 'b8c6', 'f1c4']]);
  });

  it('refuses two replies to the same move', () => {
    const tree = mergeLines([], [['e7e5', 'g1f3']]);

    expect(() => mergeLines(tree, [['e7e5', 'f1c4']])).toThrow(
      'Two different replies to e7e5',
    );
  });

  it('refuses moves that are not UCI', () => {
    expect(() => mergeLines([], [['e5', 'Nf3']])).toThrow('UCI');
  });

  it('drops a last move with no reply', () => {
    expect(trimLine(['e7e5', 'g1f3', 'b8c6'])).toEqual(['e7e5', 'g1f3']);
    expect(mergeLines([], [['e7e5']])).toEqual([]);
  });

  it("finds the branch for the opponent's move", () => {
    const tree = mergeLines(
      [],
      [
        ['e7e5', 'g1f3'],
        ['c7c5', 'b1c3'],
      ],
    );

    expect(branchFor(tree, 'c7c5')?.reply).toBe('b1c3');
    expect(branchFor(tree, 'd7d5')).toBeUndefined();
  });

  describe('conditionalStep', () => {
    // Set after white's 1. e4 (ply 1): if 1... e5 2. Nf3, then if 2... Nc6
    // 3. Bb5.
    const set = {
      basePly: 1,
      tree: mergeLines(
        [],
        [
          ['e7e5', 'g1f3', 'b8c6', 'f1b5'],
          ['c7c5', 'b1c3'],
        ],
      ),
    };

    it("plays the reply to the opponent's move, keeping what follows", () => {
      expect(conditionalStep(set, { ply: 2, from: 'e7', to: 'e5' })).toEqual({
        reply: 'g1f3',
        next: [{ opponent: 'b8c6', reply: 'f1b5', next: [] }],
        basePly: 3,
      });
    });

    it('keeps nothing once a line has run out', () => {
      expect(conditionalStep(set, { ply: 2, from: 'c7', to: 'c5' })).toEqual({
        reply: 'b1c3',
        next: [],
        basePly: 3,
      });
    });

    it("drops them all on a move they didn't foresee", () => {
      expect(conditionalStep(set, { ply: 2, from: 'd7', to: 'd5' })).toBeNull();
    });

    it('drops lines set against a position since moved on', () => {
      expect(conditionalStep(set, { ply: 4, from: 'e7', to: 'e5' })).toBeNull();
    });
  });
});

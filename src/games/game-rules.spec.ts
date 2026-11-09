import { describe, expect, it } from 'vitest';

import {
  canRespondToDraw,
  drawOfferOutcome,
  isRatedPairing,
  winnerAgainst,
  withinAbortWindow,
} from './game-rules.js';

describe('withinAbortWindow', () => {
  it('allows an abort until both sides have moved, not after', () => {
    expect(withinAbortWindow(0, 2)).toBe(true);
    expect(withinAbortWindow(1, 2)).toBe(true);
    expect(withinAbortWindow(2, 2)).toBe(false);
    expect(withinAbortWindow(3, 2)).toBe(false);
  });
});

describe('winnerAgainst', () => {
  it('gives the game to the other side', () => {
    expect(winnerAgainst('w')).toBe('black');
    expect(winnerAgainst('b')).toBe('white');
  });
});

describe('drawOfferOutcome', () => {
  it('offers a draw when none is on the table', () => {
    expect(drawOfferOutcome({ drawOfferedBy: null }, 'w')).toBe('offer');
  });

  it("accepts the opponent's offer by offering back", () => {
    expect(drawOfferOutcome({ drawOfferedBy: 'black' }, 'w')).toBe('accept');
    expect(drawOfferOutcome({ drawOfferedBy: 'white' }, 'b')).toBe('accept');
  });

  it('offers again rather than accepting its own offer', () => {
    expect(drawOfferOutcome({ drawOfferedBy: 'white' }, 'w')).toBe('offer');
  });
});

describe('canRespondToDraw', () => {
  it("answers only the opponent's offer", () => {
    expect(canRespondToDraw({ drawOfferedBy: 'black' }, 'w')).toBe(true);
    expect(canRespondToDraw({ drawOfferedBy: 'white' }, 'w')).toBe(false);
    expect(canRespondToDraw({ drawOfferedBy: null }, 'w')).toBe(false);
  });
});

describe('isRatedPairing', () => {
  const registered = { isGuest: false };
  const guest = { isGuest: true };

  it('rates a game asked to be rated between two registered players', () => {
    expect(isRatedPairing(true, registered, registered)).toBe(true);
  });

  it('never rates a casual game', () => {
    expect(isRatedPairing(false, registered, registered)).toBe(false);
  });

  it('never rates a game with a guest in it', () => {
    expect(isRatedPairing(true, guest, registered)).toBe(false);
    expect(isRatedPairing(true, registered, guest)).toBe(false);
  });
});

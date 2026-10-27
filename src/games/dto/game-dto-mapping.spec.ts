import { describe, expect, it } from 'vitest';

import type { Game } from '../entities/game.entity.js';
import type { User } from '../../users/entities/user.entity.js';
import { toGameStateDto } from './game-state.dto.js';
import { toGameSummaryDto } from './game-summary.dto.js';

function makeUser(id: string, username: string): User {
  return {
    id,
    username,
    displayName: username,
    avatarColor: '#123456',
  } as User;
}

const WHITE = makeUser('white-id', 'judit');
const BLACK = makeUser('black-id', 'magnus');

function makeFinishedGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 'game-1',
    white: WHITE,
    whiteId: WHITE.id,
    black: BLACK,
    blackId: BLACK.id,
    minutes: 5,
    incrementSeconds: 0,
    gameType: 'blitz',
    rated: true,
    whiteRating: 1620,
    blackRating: 1480,
    whiteRatingDiff: -12,
    blackRatingDiff: 12,
    status: 'completed',
    result: 'black',
    resultReason: 'checkmate',
    fen: 'fen',
    turn: 'w',
    whiteTimeRemainingMs: 1000,
    blackTimeRemainingMs: 1000,
    lastMoveAt: null,
    drawOfferedBy: null,
    moves: [],
    createdAt: new Date('2026-10-27T00:00:00Z'),
    endedAt: new Date('2026-10-27T00:05:00Z'),
    ...overrides,
  } as Game;
}

describe('toGameStateDto', () => {
  it("puts each player's starting rating beside them", () => {
    const dto = toGameStateDto(makeFinishedGame());

    expect(dto.white.rating).toBe(1620);
    expect(dto.black.rating).toBe(1480);
  });

  it('includes what the game did to both ratings', () => {
    const dto = toGameStateDto(makeFinishedGame());

    expect(dto.whiteRatingDiff).toBe(-12);
    expect(dto.blackRatingDiff).toBe(12);
  });

  it('leaves a guest without a rating', () => {
    const dto = toGameStateDto(makeFinishedGame({ blackRating: null }));

    expect(dto.black.rating).toBeNull();
  });
});

describe('toGameSummaryDto', () => {
  it("shows white's opponent rating and white's own change", () => {
    const dto = toGameSummaryDto(makeFinishedGame(), WHITE.id);

    expect(dto.opponentRating).toBe(1480);
    expect(dto.ratingDiff).toBe(-12);
  });

  it("shows black's opponent rating and black's own change", () => {
    const dto = toGameSummaryDto(makeFinishedGame(), BLACK.id);

    expect(dto.opponentRating).toBe(1620);
    expect(dto.ratingDiff).toBe(12);
  });

  it('has no change for a game that changed no ratings', () => {
    const dto = toGameSummaryDto(
      makeFinishedGame({ whiteRatingDiff: null, blackRatingDiff: null }),
      WHITE.id,
    );

    expect(dto.ratingDiff).toBeNull();
  });
});

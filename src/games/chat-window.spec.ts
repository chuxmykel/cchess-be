import { afterEach, describe, expect, it } from 'vitest';

import type { Game } from './entities/game.entity.js';
import { chatClosesAt, isChatOpen } from './chat-window.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function gameEndedAt(endedAt: Date | null): Game {
  return { endedAt } as Game;
}

describe('chat window', () => {
  afterEach(() => {
    delete process.env.GAME_CHAT_WINDOW_MS;
  });

  it('stays open while the game is in play', () => {
    const game = gameEndedAt(null);

    expect(chatClosesAt(game)).toBeNull();
    expect(isChatOpen(game)).toBe(true);
  });

  it('closes 14 days after the game ends', () => {
    const endedAt = new Date('2026-10-01T12:00:00Z');
    const game = gameEndedAt(endedAt);

    expect(chatClosesAt(game)).toEqual(
      new Date(endedAt.getTime() + 14 * DAY_MS),
    );
    expect(isChatOpen(game, new Date(endedAt.getTime() + 13 * DAY_MS))).toBe(
      true,
    );
    expect(isChatOpen(game, new Date(endedAt.getTime() + 14 * DAY_MS))).toBe(
      false,
    );
  });

  it('takes the window from GAME_CHAT_WINDOW_MS', () => {
    process.env.GAME_CHAT_WINDOW_MS = '1000';
    const endedAt = new Date('2026-10-01T12:00:00Z');

    expect(chatClosesAt(gameEndedAt(endedAt))).toEqual(
      new Date(endedAt.getTime() + 1000),
    );
  });
});

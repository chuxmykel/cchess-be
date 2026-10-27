import type { Game } from './entities/game.entity.js';

const DEFAULT_CHAT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** How long after a game ends its players may still chat. Read when
 * needed, so tests can shorten it. */
export function chatWindowMs(): number {
  return Number(process.env.GAME_CHAT_WINDOW_MS ?? DEFAULT_CHAT_WINDOW_MS);
}

/** When the game's chat stops taking messages; null while it's in play. */
export function chatClosesAt(game: Game): Date | null {
  if (!game.endedAt) return null;
  return new Date(game.endedAt.getTime() + chatWindowMs());
}

export function isChatOpen(game: Game, now = new Date()): boolean {
  const closesAt = chatClosesAt(game);
  return closesAt === null || now < closesAt;
}

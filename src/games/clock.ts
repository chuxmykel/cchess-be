import { isDailyGame } from './daily.js';
import type { Game } from './entities/game.entity.js';
import { isAwaitingFirstMove } from './first-move.js';

export type RemainingTimes = {
  whiteTimeRemainingMs: number;
  blackTimeRemainingMs: number;
};

/** Each side's time left as of `now`. The stored times are as of the last
 * move; since then the side to move's clock has been running - once both
 * sides have moved, as enforceClock counts it, or from the start in a daily
 * game, whose first moves have the same days as any other. */
export function remainingTimesAt(game: Game, now: number): RemainingTimes {
  const stored = {
    whiteTimeRemainingMs: game.whiteTimeRemainingMs,
    blackTimeRemainingMs: game.blackTimeRemainingMs,
  };
  if (game.status !== 'active') return stored;
  const runningSince = isDailyGame(game)
    ? (game.lastMoveAt ?? game.createdAt)
    : isAwaitingFirstMove(game)
      ? null
      : game.lastMoveAt;
  if (!runningSince) return stored;

  const elapsed = Math.max(now - runningSince.getTime(), 0);
  const key =
    game.turn === 'w' ? 'whiteTimeRemainingMs' : 'blackTimeRemainingMs';
  return { ...stored, [key]: Math.max(stored[key] - elapsed, 0) };
}

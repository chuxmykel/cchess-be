import { isDailyGame } from './daily.js';
import type { Game } from './entities/game.entity.js';

/** A bullet game's first-move time, as lichess gives it. */
export const BULLET_FIRST_MOVE_TIMEOUT_MS = 20_000;
/** Every other live game's - blitz, rapid and classical. */
export const FIRST_MOVE_TIMEOUT_MS = 30_000;

/** How long each side of a live game has to play its first move before the
 * game is aborted: 20s in bullet, 30s otherwise, as on lichess.
 * GAME_FIRST_MOVE_TIMEOUT_MS, read when needed so tests can shorten it,
 * stands in for both. */
export function firstMoveTimeoutMs(game: Pick<Game, 'gameType'>): number {
  const override = process.env.GAME_FIRST_MOVE_TIMEOUT_MS;
  if (override !== undefined) return Number(override);
  return game.gameType === 'bullet'
    ? BULLET_FIRST_MOVE_TIMEOUT_MS
    : FIRST_MOVE_TIMEOUT_MS;
}

function fullmoveNumber(fen: string): number {
  return Number(fen.split(' ')[5]);
}

/** True until both sides have played a move: the clocks don't run until
 * then, and the side to move has until firstMoveDeadline to play. */
export function isAwaitingFirstMove(game: Game): boolean {
  return game.status === 'active' && fullmoveNumber(game.fen) === 1;
}

/** When the side to move must have played its first move by, or the game
 * is aborted - in a daily game, the days it gives every move. */
export function firstMoveDeadline(game: Game): Date | null {
  if (!isAwaitingFirstMove(game)) return null;
  const waitingSince = game.lastMoveAt ?? game.createdAt;
  const timeoutMs = isDailyGame(game)
    ? game.initialSeconds * 1000
    : firstMoveTimeoutMs(game);
  return new Date(waitingSince.getTime() + timeoutMs);
}

/** The first-move countdown a player is shown: a live game's. A daily
 * game's first move has the same days as every other, so its clock shows
 * them instead. */
export function shownFirstMoveDeadline(game: Game): Date | null {
  return isDailyGame(game) ? null : firstMoveDeadline(game);
}

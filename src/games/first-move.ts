import type { Game } from './entities/game.entity.js';

const DEFAULT_FIRST_MOVE_TIMEOUT_MS = 30_000;

/** How long each side has to play its first move before the game is
 * aborted. Read when needed, so tests can shorten it. */
export function firstMoveTimeoutMs(): number {
  return Number(
    process.env.GAME_FIRST_MOVE_TIMEOUT_MS ?? DEFAULT_FIRST_MOVE_TIMEOUT_MS,
  );
}

function fullmoveNumber(fen: string): number {
  return Number(fen.split(' ')[5]);
}

/** True until both sides have played a move: the clocks don't run until
 * then, and the side to move has until firstMoveDeadline to play. */
export function isAwaitingFirstMove(game: Game): boolean {
  return game.status === 'active' && fullmoveNumber(game.fen) === 1;
}

export function firstMoveDeadline(game: Game): Date | null {
  if (!isAwaitingFirstMove(game)) return null;
  const waitingSince = game.lastMoveAt ?? game.createdAt;
  return new Date(waitingSince.getTime() + firstMoveTimeoutMs());
}

import type { Game } from './entities/game.entity.js';

/** A daily game - days a move, not minutes a game (see time-control.ts's
 * DAILY_DAYS). */
export function isDailyGame(game: Pick<Game, 'gameType'>): boolean {
  return game.gameType === 'daily';
}

/** When the side to move runs out of time, the game still being played:
 * their clock - in a daily game always the full days a move, reset when
 * they last moved - counted from the opponent's last move, or the game's
 * start. */
export function moveDeadline(
  game: Pick<
    Game,
    | 'status'
    | 'turn'
    | 'lastMoveAt'
    | 'createdAt'
    | 'whiteTimeRemainingMs'
    | 'blackTimeRemainingMs'
  >,
): Date | null {
  if (game.status !== 'active') return null;
  const since = (game.lastMoveAt ?? game.createdAt).getTime();
  const remaining =
    game.turn === 'w' ? game.whiteTimeRemainingMs : game.blackTimeRemainingMs;
  return new Date(since + remaining);
}

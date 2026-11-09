import { incrementMs, toClockMs } from '../chess/time-control.js';
import { isDailyGame } from './daily.js';
import type { Game } from './entities/game.entity.js';
import { firstMoveDeadline, isAwaitingFirstMove } from './first-move.js';

export type RemainingTimes = {
  whiteTimeRemainingMs: number;
  blackTimeRemainingMs: number;
};

/** Each side's time left as of `now`. The stored times are as of the last
 * move; since then the side to move's clock has been running - once both
 * sides have moved, as clockForMove counts it, or from the start in a daily
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

/** What a move by `color` at `now` does to their clock, before it's known
 * to be legal:
 * - `late-first-move`: a first move after firstMoveDeadline - the game is
 *   aborted instead.
 * - `flagged`: the time since the last move - or `chargeMs`, a pre-move's
 *   - leaves them none; the move is never played.
 * - `ok`: their clock once the move is played. A first move doesn't run
 *   it, later ones are charged and given the increment, and a daily
 *   game's every move resets it to the full days. */
export type MoveClock =
  | { status: 'late-first-move' }
  | { status: 'flagged' }
  | { status: 'ok'; remainingAfter: number };

export function clockForMove(
  game: Game,
  color: 'w' | 'b',
  now: number,
  chargeMs?: number,
): MoveClock {
  const tc = {
    initialSeconds: game.initialSeconds,
    incrementSeconds: game.incrementSeconds,
  };
  const remainingBefore =
    color === 'w' ? game.whiteTimeRemainingMs : game.blackTimeRemainingMs;

  if (isAwaitingFirstMove(game)) {
    const deadline = firstMoveDeadline(game);
    if (deadline && now > deadline.getTime()) {
      return { status: 'late-first-move' };
    }
    return {
      status: 'ok',
      remainingAfter: isDailyGame(game) ? toClockMs(tc) : remainingBefore,
    };
  }

  const sinceLastMove =
    chargeMs ?? (game.lastMoveAt ? now - game.lastMoveAt.getTime() : 0);
  const remainingAfterElapsed = remainingBefore - Math.max(sinceLastMove, 0);
  if (remainingAfterElapsed <= 0) return { status: 'flagged' };
  // A daily game's time doesn't build up: each move resets the mover's
  // clock to the full days a move.
  return {
    status: 'ok',
    remainingAfter: isDailyGame(game)
      ? toClockMs(tc)
      : remainingAfterElapsed + incrementMs(tc),
  };
}

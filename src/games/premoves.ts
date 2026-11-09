import { isDailyGame } from './daily.js';
import type { Game } from './entities/game.entity.js';
import { isAwaitingFirstMove } from './first-move.js';

/** What a pre-move takes off its player's clock: a fixed charge, not the
 * time it took to reach us, so it costs the same on any connection -
 * chess.com's 0.1s. Not nothing, or a run of them would cost nothing in a
 * time scramble. */
export const PREMOVE_CHARGE_MS = 100;

export interface Premove {
  color: 'w' | 'b';
  from: string;
  to: string;
  promotion?: string;
}

/** What a pre-move sent by `color` is: refused in a daily game - days
 * apart, its moves need none, and one held only in memory wouldn't last
 * that long anyway - played as a move on its player's own turn, or else
 * queued for the opponent's move. */
export function premoveRequest(
  game: Pick<Game, 'gameType' | 'turn'>,
  color: 'w' | 'b',
): 'refused-daily' | 'move' | 'queue' {
  if (isDailyGame(game)) return 'refused-daily';
  return game.turn === color ? 'move' : 'queue';
}

/** What becomes of the pre-move queued in `game` now that a move has
 * landed: `wait` while it's not its player's turn;
 * otherwise it leaves the queue - `play`ed, charged PREMOVE_CHARGE_MS, or
 * `drop`ped when its player hasn't that much left, their clock running on
 * to flag as usual. Before both sides have moved the clocks don't run, so
 * it's always played then. */
export function queuedPremoveAction(
  premove: Premove,
  game: Game,
): 'wait' | 'drop' | 'play' {
  if (game.status !== 'active' || premove.color !== game.turn) return 'wait';
  const remaining =
    premove.color === 'w'
      ? game.whiteTimeRemainingMs
      : game.blackTimeRemainingMs;
  if (!isAwaitingFirstMove(game) && remaining <= PREMOVE_CHARGE_MS)
    return 'drop';
  return 'play';
}

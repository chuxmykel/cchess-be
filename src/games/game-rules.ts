import type { User } from '../users/entities/user.entity.js';
import type { Game } from './entities/game.entity.js';

type Color = 'w' | 'b';

const SIDE = { w: 'white', b: 'black' } as const;

/** True while a game can still be aborted: fewer than `abortPlyLimit`
 * moves played - until both sides have moved, by default. Resigning and
 * offering a draw wait until it's past. */
export function withinAbortWindow(
  plyCount: number,
  abortPlyLimit: number,
): boolean {
  return plyCount < abortPlyLimit;
}

/** The side that wins when `color` loses - resigning, flagging or
 * abandoning the game. */
export function winnerAgainst(color: Color): 'white' | 'black' {
  return SIDE[color === 'w' ? 'b' : 'w'];
}

/** Offering a draw the opponent has already offered accepts theirs. */
export function drawOfferOutcome(
  game: Pick<Game, 'drawOfferedBy'>,
  color: Color,
): 'accept' | 'offer' {
  return game.drawOfferedBy === winnerAgainst(color) ? 'accept' : 'offer';
}

/** Only the opponent's draw offer can be answered - not one's own. */
export function canRespondToDraw(
  game: Pick<Game, 'drawOfferedBy'>,
  color: Color,
): boolean {
  return !!game.drawOfferedBy && game.drawOfferedBy !== SIDE[color];
}

/** A game is rated only when asked to be and neither player is a guest,
 * who has no rating. */
export function isRatedPairing(
  rated: boolean,
  white: Pick<User, 'isGuest'>,
  black: Pick<User, 'isGuest'>,
): boolean {
  return rated && !white.isGuest && !black.isGuest;
}

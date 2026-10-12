import type { Game } from '../games/entities/game.entity.js';
import type { Move } from '../games/entities/move.entity.js';

/**
 * TypeORM entities round-tripped through `ClusterBus` (JSON under the hood)
 * come back with Date columns as ISO strings, not Date instances - this
 * puts them back so a forwarded result looks the same to callers as a
 * locally-produced one. Only Date columns need this; everything else
 * (strings, numbers, booleans, nulls) survives JSON as-is.
 */
export function reviveDates<T extends object>(obj: T, keys: readonly (keyof T)[]): T {
  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key as string];
    if (typeof value === 'string') record[key as string] = new Date(value);
  }
  return obj;
}

/**
 * Shared by every place that sends/receives a `Game` over `ClusterBus`
 * (GamesService's own forwarding, and MatchmakingService's worker-0 seek
 * forwarding, which carries a freshly-created `Game` back when it matches
 * two players) - trims `white`/`black` down to what `toGameStateDto` and
 * `toPlayerDto` actually read, instead of shipping full `User` rows
 * (password hash included) across process IPC.
 */
export function toWireGame(game: Game): Record<string, unknown> {
  return {
    // Deliberately discarding Game's class prototype - the point is a
    // plain, JSON-serializable snapshot to send over ClusterBus.
    // eslint-disable-next-line typescript/no-misused-spread
    ...game,
    white: game.white
      ? { id: game.white.id, username: game.white.username, displayName: game.white.displayName, avatarColor: game.white.avatarColor }
      : game.white,
    black: game.black
      ? { id: game.black.id, username: game.black.username, displayName: game.black.displayName, avatarColor: game.black.avatarColor }
      : game.black,
  };
}

export function fromWireGame(wire: Record<string, unknown>): Game {
  return reviveDates(wire as unknown as Game, ['createdAt', 'lastMoveAt', 'endedAt']);
}

export function toWireMove(move: Move): Record<string, unknown> {
  // eslint-disable-next-line typescript/no-misused-spread
  return { ...move };
}

export function fromWireMove(wire: Record<string, unknown>): Move {
  return reviveDates(wire as unknown as Move, ['createdAt']);
}

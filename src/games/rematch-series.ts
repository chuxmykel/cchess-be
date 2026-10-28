import type { Game } from './entities/game.entity.js';

/** Where a rematch sits in its series: the game it follows, and each
 * player's points from the series so far, going into it. */
export interface GameSeries {
  rematchOfId: string;
  whitePoints: number;
  blackPoints: number;
}

type SeriesGame = Pick<
  Game,
  'id' | 'result' | 'rematchOfId' | 'seriesWhitePoints' | 'seriesBlackPoints'
>;

/** Each player's series points once this game's result counts - for a
 * game in progress, the points going into it. */
export function seriesPointsAfter(game: SeriesGame): {
  white: number;
  black: number;
} {
  const white = game.result === 'white' ? 1 : game.result === 'draw' ? 0.5 : 0;
  const black = game.result === 'black' ? 1 : game.result === 'draw' ? 0.5 : 0;
  return {
    white: game.seriesWhitePoints + white,
    black: game.seriesBlackPoints + black,
  };
}

/** The series a rematch of this game starts with: the players swap
 * colors, so each takes their points to the other side. */
export function seriesForRematchOf(game: SeriesGame): GameSeries {
  const after = seriesPointsAfter(game);
  return {
    rematchOfId: game.id,
    whitePoints: after.black,
    blackPoints: after.white,
  };
}

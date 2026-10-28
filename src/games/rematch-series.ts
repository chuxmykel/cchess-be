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

/** The longest gap between two games that still carries a series on. */
export const SERIES_GAP_MS = 60 * 60 * 1000;

export type SeriesCandidate = SeriesGame &
  Pick<
    Game,
    | 'whiteId'
    | 'blackId'
    | 'initialSeconds'
    | 'incrementSeconds'
    | 'rated'
    | 'endedAt'
  >;

type NewGame = Pick<
  Game,
  'whiteId' | 'blackId' | 'initialSeconds' | 'incrementSeconds' | 'rated'
>;

/**
 * The series a new game carries on, however the two were paired - a seek,
 * a challenge or a rematch - or null when it starts afresh. It carries one
 * on only when each player's last finished game was the same game, between
 * the two of them, at the same time control and just as rated, ending
 * within SERIES_GAP_MS: play anyone else in between and the series is over.
 * Points follow each player, since a pairing needn't swap their colors.
 */
export function seriesContinuedBy(
  next: NewGame,
  lastOfWhite: SeriesCandidate | null,
  lastOfBlack: SeriesCandidate | null,
  now: Date,
): GameSeries | null {
  if (!lastOfWhite || !lastOfBlack || lastOfWhite.id !== lastOfBlack.id) {
    return null;
  }
  const previous = lastOfWhite;
  const keptColors =
    previous.whiteId === next.whiteId && previous.blackId === next.blackId;
  const swappedColors =
    previous.whiteId === next.blackId && previous.blackId === next.whiteId;
  if (!keptColors && !swappedColors) return null;
  if (
    previous.initialSeconds !== next.initialSeconds ||
    previous.incrementSeconds !== next.incrementSeconds ||
    previous.rated !== next.rated
  ) {
    return null;
  }
  if (!previous.endedAt) return null;
  if (now.getTime() - previous.endedAt.getTime() > SERIES_GAP_MS) return null;
  const after = seriesPointsAfter(previous);
  return {
    rematchOfId: previous.id,
    whitePoints: keptColors ? after.white : after.black,
    blackPoints: keptColors ? after.black : after.white,
  };
}

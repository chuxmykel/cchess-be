import type { Game } from './entities/game.entity.js';

const RESULT_TAG: Record<string, string> = {
  white: '1-0',
  black: '0-1',
  draw: '1/2-1/2',
};

function pgnDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

export interface PgnPlayers {
  whiteUsername: string;
  blackUsername: string;
}

/**
 * Builds a standard seven-tag-roster PGN from a game + its SAN move list.
 * Takes plain usernames rather than `game.white`/`game.black` so callers on
 * the hot move-application path (which never load those relations - see
 * GamesService) can still produce a PGN at game-end without an extra join.
 */
export function buildPgnText(
  game: Game,
  players: PgnPlayers,
  sans: string[],
): string {
  const result = game.result ? RESULT_TAG[game.result] : '*';
  const tags = [
    `[Event "${game.rated ? 'Rated' : 'Casual'} ${game.gameType} game"]`,
    `[Site "cchess"]`,
    `[Date "${pgnDate(game.createdAt)}"]`,
    `[White "${players.whiteUsername}"]`,
    `[Black "${players.blackUsername}"]`,
    `[Result "${result}"]`,
    `[TimeControl "${game.initialSeconds}+${game.incrementSeconds}"]`,
  ];

  const movetext: string[] = [];
  for (let i = 0; i < sans.length; i += 2) {
    const moveNumber = i / 2 + 1;
    const white = sans[i];
    const black = sans[i + 1];
    movetext.push(
      black ? `${moveNumber}. ${white} ${black}` : `${moveNumber}. ${white}`,
    );
  }

  return `${tags.join('\n')}\n\n${movetext.join(' ')} ${result}`.trim();
}

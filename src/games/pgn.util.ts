import type { Game } from './entities/game.entity.js';
import type { Move } from './entities/move.entity.js';

const RESULT_TAG: Record<string, string> = {
  white: '1-0',
  black: '0-1',
  draw: '1/2-1/2',
};

// The PGN export format keeps movetext lines under 80 characters.
const MAX_LINE_LENGTH = 79;

function pgnDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

/** A clock reading for a [%clk] comment: H:MM:SS, rounded down to the
 * second so it never shows more time than the player had. */
export function pgnClock(ms: number): string {
  const totalSeconds = Math.max(Math.floor(ms / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(
    2,
    '0',
  );
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function wrap(tokens: string[]): string {
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    if (line && line.length + 1 + token.length > MAX_LINE_LENGTH) {
      lines.push(line);
      line = token;
    } else {
      line = line ? `${line} ${token}` : token;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export interface PgnPlayers {
  whiteUsername: string;
  blackUsername: string;
}

export type PgnMove = Pick<Move, 'san' | 'clockAfterMs'>;

/**
 * Builds a PGN in the standard's export format: the Seven Tag Roster plus
 * TimeControl, then the moves with each mover's clock after it as a
 * [%clk] comment. Takes plain usernames rather than `game.white`/
 * `game.black` so callers on the hot move-application path (which never
 * load those relations - see GamesService) can still produce a PGN at
 * game-end without an extra join.
 */
export function buildPgnText(
  game: Game,
  players: PgnPlayers,
  moves: PgnMove[],
): string {
  const result = game.result ? RESULT_TAG[game.result] : '*';
  const tags = [
    `[Event "${game.rated ? 'Rated' : 'Casual'} ${game.gameType} game"]`,
    `[Site "cchess"]`,
    `[Date "${pgnDate(game.createdAt)}"]`,
    `[Round "-"]`,
    `[White "${players.whiteUsername}"]`,
    `[Black "${players.blackUsername}"]`,
    `[Result "${result}"]`,
    `[TimeControl "${game.initialSeconds}+${game.incrementSeconds}"]`,
  ];

  // Every move is followed by a comment, so black's moves carry their own
  // "N..." number too, as the export format asks after a comment.
  const tokens = moves.flatMap((move, ply) => {
    const moveNumber = Math.floor(ply / 2) + 1;
    const number = ply % 2 === 0 ? `${moveNumber}.` : `${moveNumber}...`;
    return [number, move.san, `{ [%clk ${pgnClock(move.clockAfterMs)}] }`];
  });
  tokens.push(result);

  return `${tags.join('\n')}\n\n${wrap(tokens)}`;
}

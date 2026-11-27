import { Chess, type Color, type Square } from 'chess.js';

import type { ReviewScore } from '../games/entities/game-review.entity.js';
import { ENDGAME_MATERIAL } from './thresholds.js';

// Lichess's winning-chances curve: a side's chances of winning, 0 to 100,
// from an engine's score (as the app's winChances.ts).
const CURVE = 0.00368208;
const CAP_CP = 1000;

export function winPercent(score: ReviewScore, color: Color): number {
  const cp =
    score.kind === 'mate'
      ? score.winner === 'w'
        ? CAP_CP
        : -CAP_CP
      : Math.max(-CAP_CP, Math.min(CAP_CP, score.cp));
  const white = 50 + 50 * (2 / (1 + Math.exp(-CURVE * cp)) - 1);
  return color === 'w' ? white : 100 - white;
}

const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

// Little left on the board: no queens, or not much besides.
export function isEndgame(fen: string): boolean {
  let pieces = 0;
  let queens = 0;
  for (const char of fen.split(' ')[0]) {
    const type = char.toLowerCase();
    if (type === 'q') queens += 1;
    if ('nbrq'.includes(type)) pieces += VALUES[type];
  }
  return (
    pieces <=
    (queens === 0
      ? ENDGAME_MATERIAL.withoutQueens
      : ENDGAME_MATERIAL.withQueens)
  );
}

/** How far a side is behind in material, in pawns - 0 if it isn't. */
export function materialDown(fen: string, color: Color): number {
  let lead = 0;
  for (const char of fen.split(' ')[0]) {
    const type = char.toLowerCase();
    if (!(type in VALUES)) continue;
    const isWhite = char !== type;
    lead += (isWhite === (color === 'w') ? 1 : -1) * VALUES[type];
  }
  return Math.max(0, -lead);
}

export const other = (color: Color): Color => (color === 'w' ? 'b' : 'w');

function neighbours(square: Square): Square[] {
  const file = square.charCodeAt(0);
  const rank = Number(square[1]);
  const around: Square[] = [];
  for (const df of [-1, 0, 1]) {
    for (const dr of [-1, 0, 1]) {
      const f = file + df;
      const r = rank + dr;
      if ((df || dr) && f >= 97 && f <= 104 && r >= 1 && r <= 8) {
        around.push(`${String.fromCharCode(f)}${r}` as Square);
      }
    }
  }
  return around;
}

export function kingOf(fen: string, color: Color): Square | null {
  for (const row of new Chess(fen).board()) {
    for (const piece of row) {
      if (piece?.type === 'k' && piece.color === color) return piece.square;
    }
  }
  return null;
}

/** How a mating move mated: a knight's, the king hemmed in by its own
 * pieces; a rook or queen on the back rank, the king walled in; a pawn's. */
export function mateKind(
  san: string,
  fenAfter: string,
  mover: Color,
): 'smothered' | 'backRank' | 'pawn' | 'other' | null {
  if (!san.endsWith('#')) return null;
  if (/^[a-h]/.test(san)) return 'pawn';
  const chess = new Chess(fenAfter);
  const mated = other(mover);
  const king = kingOf(fenAfter, mated);
  if (!king) return 'other';
  const around = neighbours(king);
  if (
    san.startsWith('N') &&
    around.every((square) => chess.get(square)?.color === mated)
  ) {
    return 'smothered';
  }
  const backRank = mated === 'w' ? '1' : '8';
  if (/^[QR]/.test(san) && king[1] === backRank) {
    const ahead = around.filter((square) => square[1] !== backRank);
    if (ahead.every((square) => chess.get(square)?.color === mated)) {
      return 'backRank';
    }
  }
  return 'other';
}

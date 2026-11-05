/**
 * A position's key, for finding where else it was reached: its FEN's
 * placement, side to move, castling and en passant fields (its EPD), less
 * the move counters - so the same position reached by different move
 * orders shares one.
 */
export function positionKey(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(' ');
}

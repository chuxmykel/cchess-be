import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';

export type MoveOutcome =
  | { status: 'illegal' }
  | { status: 'needs-promotion-choice' }
  | { status: 'ok'; move: AppliedMove; fen: string; gameOverReason: GameOverReason };

export interface AppliedMove {
  from: Square;
  to: Square;
  piece: PieceSymbol;
  color: Color;
  san: string;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  isCapture: boolean;
  isEnPassant: boolean;
  isKingSideCastle: boolean;
  isQueenSideCastle: boolean;
  isPromotion: boolean;
  isCheck: boolean;
  isCheckmate: boolean;
}

export type GameOverReason =
  | 'checkmate'
  | 'stalemate'
  | 'insufficient-material'
  | 'threefold-repetition'
  | 'fifty-move-rule'
  | null;

function toAppliedMove(move: Move, isCheck: boolean, isCheckmate: boolean): AppliedMove {
  return {
    from: move.from,
    to: move.to,
    piece: move.piece,
    color: move.color,
    san: move.san,
    captured: move.captured,
    promotion: move.promotion,
    isCapture: Boolean(move.captured),
    isEnPassant: move.isEnPassant(),
    isKingSideCastle: move.isKingsideCastle(),
    isQueenSideCastle: move.isQueensideCastle(),
    isPromotion: move.isPromotion(),
    isCheck,
    isCheckmate,
  };
}

/**
 * Server-side authority over chess rules. Mirrors the shape of the client's
 * ChessEngine (src/domain/ChessEngine.ts in the cchess app) but owns the
 * actual source of truth: every move a client submits is re-validated here
 * before it is persisted or broadcast.
 */
export class ServerChessEngine {
  private game: Chess;

  constructor(fen?: string) {
    this.game = fen ? new Chess(fen) : new Chess();
  }

  static fromPgn(pgn: string): ServerChessEngine {
    const engine = new ServerChessEngine();
    engine.game.loadPgn(pgn);
    return engine;
  }

  attemptMove(from: Square, to: Square, promotionPiece?: PieceSymbol): MoveOutcome {
    const legalMoves = this.game.moves({ square: from, verbose: true });
    const legalMove = legalMoves.find((move) => move.to === to);

    if (!legalMove) {
      return { status: 'illegal' };
    }

    if (legalMove.isPromotion() && !promotionPiece) {
      return { status: 'needs-promotion-choice' };
    }

    const appliedRaw = promotionPiece
      ? this.game.move({ from, to, promotion: promotionPiece })
      : this.game.move(legalMove);

    const isCheck = this.game.isCheck();
    // chess.js's isCheckmate()/isStalemate() each independently regenerate
    // the full legal-move list (its most expensive operation) - compute
    // "any legal replies?" once and derive both from it, and resolve the
    // reason here so callers don't need their own redundant call.
    const hasLegalReplies = this.game.moves().length > 0;
    const isCheckmate = isCheck && !hasLegalReplies;
    const isStalemate = !isCheck && !hasLegalReplies;

    return {
      status: 'ok',
      move: toAppliedMove(appliedRaw, isCheck, isCheckmate),
      fen: this.game.fen(),
      gameOverReason: this.resolveGameOverReason(isCheckmate, isStalemate),
    };
  }

  getTurn(): Color {
    return this.game.turn();
  }

  getFen(): string {
    return this.game.fen();
  }

  getPgn(): string {
    return this.game.pgn();
  }

  history(): string[] {
    return this.game.history();
  }

  isGameOver(): boolean {
    return this.game.isGameOver();
  }

  isCheck(): boolean {
    return this.game.isCheck();
  }

  isCheckmate(): boolean {
    return this.game.isCheckmate();
  }

  isDraw(): boolean {
    return this.game.isDraw();
  }

  isStalemate(): boolean {
    return this.game.isStalemate();
  }

  isThreefoldRepetition(): boolean {
    return this.game.isThreefoldRepetition();
  }

  isInsufficientMaterial(): boolean {
    return this.game.isInsufficientMaterial();
  }

  isFiftyMoveDraw(): boolean {
    // chess.js folds the fifty-move rule into isDraw()/isDrawByFiftyMoves()
    // depending on version; both are exposed, so prefer the explicit one.
    return typeof this.game.isDrawByFiftyMoves === 'function'
      ? this.game.isDrawByFiftyMoves()
      : false;
  }

  getGameOverReason(): GameOverReason {
    return this.resolveGameOverReason(this.isCheckmate(), this.isStalemate());
  }

  // Shared priority order between getGameOverReason() (computes isCheckmate/
  // isStalemate the expensive way, chess.js regenerating the legal-move list
  // for each) and attemptMove (derives them for free from a check it already
  // had to do) - only the cost of getting those two booleans differs, not
  // the order the rest of the reasons should be checked in.
  private resolveGameOverReason(isCheckmate: boolean, isStalemate: boolean): GameOverReason {
    if (isCheckmate) return 'checkmate';
    if (isStalemate) return 'stalemate';
    if (this.isInsufficientMaterial()) return 'insufficient-material';
    if (this.isThreefoldRepetition()) return 'threefold-repetition';
    if (this.isFiftyMoveDraw()) return 'fifty-move-rule';
    return null;
  }
}

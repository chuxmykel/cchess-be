import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ServerChessEngine } from '../chess/chess-engine.js';
import { positionKey } from '../chess/position-key.js';
import { Move } from '../games/entities/move.entity.js';

/** The most moves an explorer lists for a position. */
export const MAX_EXPLORER_MOVES = 20;

export interface ExplorerMove {
  san: string;
  /** e.g. "e2e4", or "e7e8q" for a promotion. */
  uci: string;
  games: number;
  whiteWins: number;
  draws: number;
  blackWins: number;
}

export interface ExplorerPosition {
  /** Finished games that reached the position and went on from it. */
  totalGames: number;
  /** The moves played from it, the most played first. */
  moves: ExplorerMove[];
}

interface ExplorerRow {
  san: string;
  from: string;
  to: string;
  promotion: string | null;
  games: string;
  whiteWins: string;
  draws: string;
  blackWins: string;
}

/**
 * An opening explorer from the games played here: for a position, every
 * move played from it and how those games ended. Finished games only - a
 * game still being played, a daily one above all, can't be looked up
 * while it's on. A game reaching the position twice counts once a move.
 */
@Injectable()
export class ExplorerService {
  constructor(
    @InjectRepository(Move) private readonly moves: Repository<Move>,
  ) {}

  async explore(fen: string): Promise<ExplorerPosition> {
    try {
      new ServerChessEngine(fen);
    } catch {
      throw new BadRequestException('Invalid FEN');
    }
    const key = positionKey(fen);

    const [rows, total]: [ExplorerRow[], Array<{ count: string }>] =
      await Promise.all([
        this.moves.query(
          `WITH played AS (
             SELECT DISTINCT m."gameId", m.san, m."from", m."to", m.promotion, g.result
             FROM moves m JOIN games g ON g.id = m."gameId"
             WHERE m."positionKey" = $1 AND m."deletedAt" IS NULL
               AND g.status = 'completed' AND g."deletedAt" IS NULL
           )
           SELECT san, "from", "to", promotion,
             COUNT(*) AS games,
             COUNT(*) FILTER (WHERE result = 'white') AS "whiteWins",
             COUNT(*) FILTER (WHERE result = 'draw') AS draws,
             COUNT(*) FILTER (WHERE result = 'black') AS "blackWins"
           FROM played
           GROUP BY san, "from", "to", promotion
           ORDER BY games DESC, san
           LIMIT $2`,
          [key, MAX_EXPLORER_MOVES],
        ),
        this.moves.query(
          `SELECT COUNT(DISTINCT m."gameId") AS count
           FROM moves m JOIN games g ON g.id = m."gameId"
           WHERE m."positionKey" = $1 AND m."deletedAt" IS NULL
             AND g.status = 'completed' AND g."deletedAt" IS NULL`,
          [key],
        ),
      ]);

    return {
      totalGames: Number(total[0]?.count ?? 0),
      moves: rows.map((row) => ({
        san: row.san,
        uci: `${row.from}${row.to}${row.promotion ?? ''}`,
        games: Number(row.games),
        whiteWins: Number(row.whiteWins),
        draws: Number(row.draws),
        blackWins: Number(row.blackWins),
      })),
    };
  }
}

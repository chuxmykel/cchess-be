import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ServerChessEngine } from '../chess/chess-engine.js';
import { positionKey } from '../chess/position-key.js';
import { Move } from '../games/entities/move.entity.js';
import type { ExplorerQuery, ExplorerSource } from './dto/explorer.dto.js';
import {
  EXPLORER_FRESH_MS,
  ExplorerCacheService,
} from './explorer-cache.service.js';
import {
  isDefaultFilters,
  normalizeFilters,
} from './lichess/lichess-defaults.js';
import type {
  LichessDb,
  LichessExplorerRequest,
  LichessPayload,
} from './lichess/lichess-explorer.client.js';
import { LichessFetcherService } from './lichess/lichess-fetcher.service.js';

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
  source: ExplorerSource;
  /** Lichess's answer as kept over 30 days ago, a fresh one on its way. */
  stale: boolean;
  /** Games that reached the position and went on from it, and how they
   * ended. */
  totalGames: number;
  whiteWins: number;
  draws: number;
  blackWins: number;
  /** The moves played from it, the most played first. */
  moves: ExplorerMove[];
}

/** One player's games, from one side - the Player database. */
interface PlayerFilter {
  userId: string;
  color: 'white' | 'black';
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

type TotalsRow = Omit<ExplorerRow, 'san' | 'from' | 'to' | 'promotion'>;

/**
 * An opening explorer: for a position, every move played from it and how
 * those games ended - in lichess's Masters or Lichess database, kept in
 * the database (ExplorerCacheService) and asked of lichess one request at
 * a time (LichessFetcherService); or in the games played here, everyone's
 * or one player's. Finished games only, here - a game still being played,
 * a daily one above all, can't be looked up while it's on. A game reaching
 * the position twice counts once a move.
 */
@Injectable()
export class ExplorerService {
  constructor(
    @InjectRepository(Move) private readonly moves: Repository<Move>,
    private readonly cache: ExplorerCacheService,
    private readonly fetcher: LichessFetcherService,
  ) {}

  async explore(query: ExplorerQuery): Promise<ExplorerPosition> {
    try {
      new ServerChessEngine(query.fen);
    } catch {
      throw new BadRequestException('Invalid FEN');
    }
    switch (query.db) {
      case 'masters':
      case 'lichess':
        return this.fromLichess(query.db, query);
      case 'player':
        return this.played(query.fen, 'player', {
          userId: query.user!,
          color: query.color ?? 'white',
        });
      default:
        return this.played(query.fen, 'cchess');
    }
  }

  private async fromLichess(
    db: LichessDb,
    query: ExplorerQuery,
  ): Promise<ExplorerPosition> {
    if (!this.fetcher.configured) return this.played(query.fen, 'cchess');
    const filters = db === 'lichess' ? normalizeFilters(query) : undefined;
    const request: LichessExplorerRequest = { db, fen: query.fen, filters };

    if (filters && !isDefaultFilters(filters)) {
      const result = await this.fetcher.fetch(request);
      return result.status === 'ok'
        ? fromPayload(db, result.payload, false)
        : this.played(query.fen, 'cchess');
    }

    const { positionId, cached } = await this.cache.open(db, query.fen);
    if (cached) {
      const stale = Date.now() - cached.fetchedAt.getTime() > EXPLORER_FRESH_MS;
      if (stale) this.fetcher.refreshInBackground({ positionId, request });
      return fromPayload(db, cached.payload, stale);
    }
    const result = await this.fetcher.fetch(request);
    if (result.status !== 'ok') return this.played(query.fen, 'cchess');
    await this.cache.store(positionId, result.payload);
    return fromPayload(db, result.payload, false);
  }

  private async played(
    fen: string,
    source: 'cchess' | 'player',
    player?: PlayerFilter,
  ): Promise<ExplorerPosition> {
    const params: unknown[] = [positionKey(fen)];
    let playerClause = '';
    if (player) {
      params.push(player.userId);
      playerClause = `AND g."${player.color === 'white' ? 'whiteId' : 'blackId'}" = $2`;
    }
    const played = `SELECT DISTINCT m."gameId", m.san, m."from", m."to", m.promotion, g.result
      FROM moves m JOIN games g ON g.id = m."gameId"
      WHERE m."positionKey" = $1 AND m."deletedAt" IS NULL
        AND g.status = 'completed' AND g."deletedAt" IS NULL ${playerClause}`;
    const results = `COUNT(*) AS games,
      COUNT(*) FILTER (WHERE result = 'white') AS "whiteWins",
      COUNT(*) FILTER (WHERE result = 'draw') AS draws,
      COUNT(*) FILTER (WHERE result = 'black') AS "blackWins"`;

    const [rows, [totals]]: [ExplorerRow[], TotalsRow[]] = await Promise.all([
      this.moves.query(
        `WITH played AS (${played})
         SELECT san, "from", "to", promotion, ${results}
         FROM played
         GROUP BY san, "from", "to", promotion
         ORDER BY games DESC, san
         LIMIT $${params.length + 1}`,
        [...params, MAX_EXPLORER_MOVES],
      ),
      this.moves.query(
        `WITH played AS (${played})
         SELECT ${results}
         FROM (SELECT DISTINCT "gameId", result FROM played) AS games`,
        params,
      ),
    ]);

    return {
      source,
      stale: false,
      totalGames: Number(totals?.games ?? 0),
      whiteWins: Number(totals?.whiteWins ?? 0),
      draws: Number(totals?.draws ?? 0),
      blackWins: Number(totals?.blackWins ?? 0),
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

function fromPayload(
  db: LichessDb,
  payload: LichessPayload,
  stale: boolean,
): ExplorerPosition {
  return {
    source: db,
    stale,
    totalGames: payload.white + payload.draws + payload.black,
    whiteWins: payload.white,
    draws: payload.draws,
    blackWins: payload.black,
    moves: payload.moves
      .map((move) => ({
        san: move.san,
        uci: move.uci,
        games: move.white + move.draws + move.black,
        whiteWins: move.white,
        draws: move.draws,
        blackWins: move.black,
      }))
      .sort((a, b) => b.games - a.games)
      .slice(0, MAX_EXPLORER_MOVES),
  };
}

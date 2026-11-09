import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration.js';

/** Lichess's two databases: games of masters, and games played on lichess. */
export type LichessDb = 'masters' | 'lichess';

export const LICHESS_SPEEDS = [
  'ultraBullet',
  'bullet',
  'blitz',
  'rapid',
  'classical',
  'correspondence',
] as const;
export type LichessSpeed = (typeof LICHESS_SPEEDS)[number];

/** Each band is the ratings from it up to the next. */
export const LICHESS_RATINGS = [
  400, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500,
] as const;
export type LichessRating = (typeof LICHESS_RATINGS)[number];

/** The Lichess database's filters; Masters has none. */
export interface LichessFilters {
  speeds: LichessSpeed[];
  ratings: LichessRating[];
}

/** A move as kept from lichess's reply. */
export interface LichessMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
}

/** Lichess's reply, trimmed to what the explorer shows. */
export interface LichessPayload {
  white: number;
  draws: number;
  black: number;
  moves: LichessMove[];
}

export type LichessFetchResult =
  | { status: 'ok'; payload: LichessPayload }
  | { status: 'rateLimited' }
  | { status: 'failed' };

export interface LichessExplorerRequest {
  db: LichessDb;
  fen: string;
  /** The Lichess database's only. */
  filters?: LichessFilters;
}

/** The most moves asked of lichess for a position. */
const LICHESS_MOVES = 20;
const LICHESS_TIMEOUT_MS = 10_000;

/** Lichess's explorer writes castling as the king taking its rook, as in
 * Chess960; the app's moves, like chess.js's, are the king's own two steps. */
const CASTLING: Record<string, string> = {
  e1h1: 'e1g1',
  e1a1: 'e1c1',
  e8h8: 'e8g8',
  e8a8: 'e8c8',
};

export function normalizeCastling(move: { uci: string; san: string }): string {
  return move.san.startsWith('O-O')
    ? (CASTLING[move.uci] ?? move.uci)
    : move.uci;
}

interface RawLichessReply {
  white?: number;
  draws?: number;
  black?: number;
  moves?: Array<{
    uci: string;
    san: string;
    white: number;
    draws: number;
    black: number;
  }>;
}

export function trimLichessReply(reply: RawLichessReply): LichessPayload {
  return {
    white: reply.white ?? 0,
    draws: reply.draws ?? 0,
    black: reply.black ?? 0,
    moves: (reply.moves ?? []).map((move) => ({
      uci: normalizeCastling(move),
      san: move.san,
      white: move.white,
      draws: move.draws,
      black: move.black,
    })),
  };
}

/**
 * Lichess's opening explorer (explorer.lichess.ovh), asked as the app's own
 * lichess account. Only `LichessFetchQueue` calls it - one request at a
 * time, as lichess asks - and tests replace it with a fake.
 */
@Injectable()
export class LichessExplorerClient {
  private readonly logger = new Logger(LichessExplorerClient.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  /** False without a token: lichess's explorer needs one. */
  get configured(): boolean {
    return Boolean(this.config.get('lichess.token', { infer: true }));
  }

  async fetch(request: LichessExplorerRequest): Promise<LichessFetchResult> {
    const token = this.config.get('lichess.token', { infer: true });
    if (!token) return { status: 'failed' };
    const url = new URL(
      `/${request.db}`,
      this.config.get('lichess.explorerUrl', { infer: true }),
    );
    url.searchParams.set('fen', request.fen);
    url.searchParams.set('moves', String(LICHESS_MOVES));
    url.searchParams.set('topGames', '0');
    if (request.db === 'lichess') {
      url.searchParams.set('variant', 'standard');
      url.searchParams.set('recentGames', '0');
      if (request.filters) {
        url.searchParams.set('speeds', request.filters.speeds.join(','));
        url.searchParams.set('ratings', request.filters.ratings.join(','));
      }
    }

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(LICHESS_TIMEOUT_MS),
      });
      if (response.status === 429) return { status: 'rateLimited' };
      if (!response.ok) {
        this.logger.warn(`Lichess explorer answered ${response.status}`);
        return { status: 'failed' };
      }
      return {
        status: 'ok',
        payload: trimLichessReply((await response.json()) as RawLichessReply),
      };
    } catch (error) {
      this.logger.warn(`Lichess explorer unreachable: ${String(error)}`);
      return { status: 'failed' };
    }
  }
}

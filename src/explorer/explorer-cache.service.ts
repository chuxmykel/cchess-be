import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { positionKey } from '../chess/position-key.js';
import { ExplorerCacheEntry } from './entities/explorer-cache-entry.entity.js';
import { ExplorerPosition } from './entities/explorer-position.entity.js';
import type {
  LichessDb,
  LichessPayload,
} from './lichess/lichess-explorer.client.js';

/** How long lichess's answer is served as it is; after that it's still
 * served, marked stale, while a fresh one is fetched. */
export const EXPLORER_FRESH_MS = 30 * 24 * 60 * 60 * 1000;
/** How long an answer is kept with its position unopened (unless pinned)
 * - then soft-deleted, and purged this long after that. */
export const EXPLORER_EXPIRE_DAYS = 90;
export const EXPLORER_PURGE_DAYS = 30;

/** A pinned position with no answer kept, or one gone stale. */
export interface DuePosition {
  positionId: string;
  db: LichessDb;
  epd: string;
}

export interface OpenedPosition {
  positionId: string;
  /** Null when there's none, or it expired. */
  cached: { payload: LichessPayload; fetchedAt: Date } | null;
}

/** Lichess's answers, kept in the database - see ExplorerPosition and
 * ExplorerCacheEntry. */
@Injectable()
export class ExplorerCacheService {
  constructor(
    @InjectRepository(ExplorerPosition)
    private readonly positions: Repository<ExplorerPosition>,
    @InjectRepository(ExplorerCacheEntry)
    private readonly entries: Repository<ExplorerCacheEntry>,
  ) {}

  /** Counts the position opened - a row for it if it has none - and gives
   * lichess's answer for it, if kept. */
  async open(db: LichessDb, fen: string): Promise<OpenedPosition> {
    const [row]: Array<{ id: string }> = await this.positions.query(
      `INSERT INTO explorer_positions (db, epd, hits, "lastOpenedAt")
       VALUES ($1, $2, 1, now())
       ON CONFLICT (db, epd) DO UPDATE SET
         hits = explorer_positions.hits + 1,
         "lastOpenedAt" = now(),
         "updatedAt" = now()
       RETURNING id`,
      [db, positionKey(fen)],
    );
    const entry = await this.entries.findOneBy({
      positionId: row.id,
      deletedAt: IsNull(),
    });
    return {
      positionId: row.id,
      cached: entry
        ? { payload: entry.payload, fetchedAt: entry.fetchedAt }
        : null,
    };
  }

  /** Pinned positions to fetch: those with no answer kept first, then the
   * longest kept. */
  async duePinned(limit: number): Promise<DuePosition[]> {
    return this.positions.query(
      `SELECT p.id AS "positionId", p.db, p.epd
       FROM explorer_positions p
       LEFT JOIN explorer_cache c
         ON c."positionId" = p.id AND c."deletedAt" IS NULL
       WHERE p.pinned AND p."deletedAt" IS NULL
         AND (c."positionId" IS NULL
              OR c."fetchedAt" < now() - make_interval(secs => $1))
       ORDER BY c."fetchedAt" ASC NULLS FIRST, p.epd
       LIMIT $2`,
      [EXPLORER_FRESH_MS / 1000, limit],
    );
  }

  /** Soft-deletes the answers of positions unopened for 90 days - pinned
   * ones aside - and purges those soft-deleted 30 days ago. How many of
   * each. */
  async sweep(): Promise<{ expired: number; purged: number }> {
    const [, expired]: [unknown, number] = await this.entries.query(
      `UPDATE explorer_cache c SET "deletedAt" = now(), "updatedAt" = now()
       FROM explorer_positions p
       WHERE p.id = c."positionId" AND NOT p.pinned AND c."deletedAt" IS NULL
         AND COALESCE(p."lastOpenedAt", p."createdAt")
             < now() - make_interval(days => $1)`,
      [EXPLORER_EXPIRE_DAYS],
    );
    const [, purged]: [unknown, number] = await this.entries.query(
      `DELETE FROM explorer_cache
       WHERE "deletedAt" < now() - make_interval(days => $1)`,
      [EXPLORER_PURGE_DAYS],
    );
    return { expired, purged };
  }

  /** Keeps lichess's answer - bringing back one that had expired. */
  async store(positionId: string, payload: LichessPayload): Promise<void> {
    await this.entries.upsert(
      { positionId, payload, fetchedAt: new Date(), deletedAt: null },
      ['positionId'],
    );
  }
}

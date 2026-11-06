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

  /** Keeps lichess's answer - bringing back one that had expired. */
  async store(positionId: string, payload: LichessPayload): Promise<void> {
    await this.entries.upsert(
      { positionId, payload, fetchedAt: new Date(), deletedAt: null },
      ['positionId'],
    );
  }
}

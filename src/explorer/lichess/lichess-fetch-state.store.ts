import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  LICHESS_FETCH_STATE_ID,
  LichessFetchState,
} from '../entities/lichess-fetch-state.entity.js';
import type { FetchQueueState } from './lichess-fetch-queue.js';

/** The lichess queue's learned state, in its one row. */
@Injectable()
export class LichessFetchStateStore {
  constructor(
    @InjectRepository(LichessFetchState)
    private readonly states: Repository<LichessFetchState>,
  ) {}

  /** What was kept, or null before anything has been. */
  async load(): Promise<FetchQueueState | null> {
    const row = await this.states.findOneBy({ id: LICHESS_FETCH_STATE_ID });
    if (!row) return null;
    return {
      gapMs: row.gapMs,
      floorMs: row.floorMs,
      floorSetAt: row.floorSetAt?.getTime() ?? null,
      rateLimitedInARow: row.rateLimitedInARow,
      pausedUntil: row.pausedUntil?.getTime() ?? 0,
    };
  }

  async save(state: FetchQueueState): Promise<void> {
    await this.states.upsert(
      {
        id: LICHESS_FETCH_STATE_ID,
        gapMs: state.gapMs,
        floorMs: state.floorMs,
        floorSetAt:
          state.floorSetAt === null ? null : new Date(state.floorSetAt),
        rateLimitedInARow: state.rateLimitedInARow,
        pausedUntil: state.pausedUntil ? new Date(state.pausedUntil) : null,
        deletedAt: null,
      },
      ['id'],
    );
  }
}

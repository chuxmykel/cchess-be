import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../config/configuration.js';
import { ExplorerCacheService } from './explorer-cache.service.js';
import { DEFAULT_LICHESS_FILTERS } from './lichess/lichess-defaults.js';
import { realClock } from './lichess/lichess-fetch-queue.js';
import { LichessFetcherService } from './lichess/lichess-fetcher.service.js';

/** How often expired answers are swept. */
export const EXPLORER_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** How long the refresh waits once nothing's due, or after lichess fails. */
const IDLE_MS = 10 * 60 * 1000;
const FAILED_MS = 60 * 1000;
/** Pinned positions read at a time. */
const BATCH = 50;

/**
 * The explorer's cache upkeep, on the fetcher worker alone: every hour,
 * the answers of positions long unopened expire (ExplorerCacheService's
 * `sweep`); and all the while, pinned positions - the opening book's -
 * are fetched from lichess when they've no answer, or theirs is over 30
 * days old. Those go by the queue's background lane, a second apart and
 * after any player's, so the first fill (some 16,000) takes hours and
 * each month's refresh trickles.
 */
@Injectable()
export class ExplorerSweeper
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ExplorerSweeper.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly cache: ExplorerCacheService,
    private readonly fetcher: LichessFetcherService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('lichess.maintenance', { infer: true })) return;
    if (!this.fetcher.isFetcher) return;
    void this.sweep();
    this.timer = setInterval(() => {
      void this.sweep();
    }, EXPLORER_SWEEP_INTERVAL_MS);
    this.timer.unref?.();
    if (this.fetcher.configured) void this.refreshForever();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    try {
      const { expired, purged } = await this.cache.sweep();
      if (expired + purged > 0) {
        this.logger.debug(`explorer: ${expired} expired, ${purged} purged`);
      }
    } catch (error) {
      this.logger.warn(`explorer sweep failed: ${(error as Error).message}`);
    }
  }

  /** Fetches up to `limit` due pinned positions, one after another; how
   * many were fetched, stopping at the first lichess didn't answer. */
  async refreshDue(limit = BATCH): Promise<{ due: number; fetched: number }> {
    const due = await this.cache.duePinned(limit);
    let fetched = 0;
    for (const position of due) {
      if (this.stopped) break;
      const ok = await this.fetcher.refreshLocal({
        positionId: position.positionId,
        request: {
          db: position.db,
          fen: `${position.epd} 0 1`,
          filters:
            position.db === 'lichess' ? DEFAULT_LICHESS_FILTERS : undefined,
        },
      });
      if (!ok) break;
      fetched++;
    }
    return { due: due.length, fetched };
  }

  private async refreshForever(): Promise<void> {
    while (!this.stopped) {
      let wait = 0;
      try {
        const { due, fetched } = await this.refreshDue();
        if (due === 0) wait = IDLE_MS;
        else if (fetched < due) wait = FAILED_MS;
      } catch (error) {
        this.logger.warn(
          `explorer refresh failed: ${(error as Error).message}`,
        );
        wait = FAILED_MS;
      }
      if (wait > 0) await realClock.sleep(wait);
    }
  }
}

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
  /** Whether the last pass found nothing due - so going idle, and waking
   * to work again, are each logged once rather than every pass. */
  private idle = false;

  constructor(
    private readonly cache: ExplorerCacheService,
    private readonly fetcher: LichessFetcherService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('lichess.maintenance', { infer: true })) {
      this.logger.log('explorer upkeep off (EXPLORER_MAINTENANCE=false)');
      return;
    }
    if (!this.fetcher.isFetcher) {
      this.logger.debug(
        `explorer upkeep left to worker ${LichessFetcherService.FETCHER_WORKER}`,
      );
      return;
    }
    this.logger.log(
      `explorer upkeep started: expired answers swept every ${EXPLORER_SWEEP_INTERVAL_MS / 60_000} min`,
    );
    void this.sweep();
    this.timer = setInterval(() => {
      void this.sweep();
    }, EXPLORER_SWEEP_INTERVAL_MS);
    this.timer.unref?.();
    if (this.fetcher.configured) {
      void this.refreshForever();
    } else {
      this.logger.log(
        'no LICHESS_TOKEN: pinned positions are not fetched from lichess',
      );
    }
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.logger.log('explorer upkeep stopped');
  }

  async sweep(): Promise<void> {
    this.logger.debug('explorer sweep: looking for expired answers');
    try {
      const { expired, purged } = await this.cache.sweep();
      if (expired + purged > 0) {
        this.logger.log(
          `explorer sweep: ${expired} answer(s) expired, ${purged} purged`,
        );
      } else {
        this.logger.debug('explorer sweep: nothing to expire or purge');
      }
    } catch (error) {
      this.logger.warn(`explorer sweep failed: ${(error as Error).message}`);
    }
  }

  /** Fetches up to `limit` due pinned positions, one after another; how
   * many were fetched, stopping at the first lichess didn't answer. */
  async refreshDue(limit = BATCH): Promise<{ due: number; fetched: number }> {
    const due = await this.cache.duePinned(limit);
    this.logger.debug(`explorer refresh: ${due.length} pinned position(s) due`);
    const startedAt = Date.now();
    let fetched = 0;
    for (const position of due) {
      if (this.stopped) {
        this.logger.debug('explorer refresh: stopping mid-batch');
        break;
      }
      const status = await this.fetcher.refreshLocal({
        positionId: position.positionId,
        request: {
          db: position.db,
          fen: `${position.epd} 0 1`,
          filters:
            position.db === 'lichess' ? DEFAULT_LICHESS_FILTERS : undefined,
        },
      });
      if (status !== 'ok') {
        this.logger.warn(
          `explorer refresh: lichess ${status === 'rateLimited' ? 'rate-limited us' : 'failed'} on ${position.db} ${position.epd}`,
        );
        break;
      }
      this.logger.verbose(
        `explorer refresh: fetched ${position.db} ${position.epd}`,
      );
      fetched++;
    }
    if (due.length > 0) {
      this.logger.log(
        `explorer refresh: fetched ${fetched} of ${due.length} due in ${Math.round((Date.now() - startedAt) / 1000)}s`,
      );
    }
    return { due: due.length, fetched };
  }

  private async refreshForever(): Promise<void> {
    this.logger.log('explorer refresh: fetching due pinned positions');
    while (!this.stopped) {
      let wait = 0;
      try {
        const { due, fetched } = await this.refreshDue();
        if (due === 0) {
          if (!this.idle) {
            this.logger.log(
              `explorer refresh: every pinned position is fresh, checking every ${IDLE_MS / 60_000} min`,
            );
          }
          this.idle = true;
          wait = IDLE_MS;
        } else {
          if (this.idle) {
            this.logger.log('explorer refresh: positions due again');
          }
          this.idle = false;
          if (fetched < due) {
            this.logger.warn(
              `explorer refresh: pausing ${FAILED_MS / 1000}s after lichess didn't answer`,
            );
            wait = FAILED_MS;
          }
        }
      } catch (error) {
        this.logger.warn(
          `explorer refresh failed: ${(error as Error).message}; retrying in ${FAILED_MS / 1000}s`,
        );
        wait = FAILED_MS;
      }
      if (wait > 0) await realClock.sleep(wait);
    }
    this.logger.log('explorer refresh: stopped');
  }
}

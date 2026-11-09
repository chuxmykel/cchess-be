import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../config/configuration.js';
import type {
  DuePosition,
  ExplorerCacheService,
} from './explorer-cache.service.js';
import { ExplorerSweeper } from './explorer.sweeper.js';
import { DEFAULT_LICHESS_FILTERS } from './lichess/lichess-defaults.js';
import type { LichessFetchResult } from './lichess/lichess-explorer.client.js';
import type { LichessFetcherService } from './lichess/lichess-fetcher.service.js';

const START_EPD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';

function due(positionId: string, db: DuePosition['db']): DuePosition {
  return { positionId, db, epd: START_EPD };
}

/** The sweeper over stand-ins: `due` the pinned positions waiting, and
 * lichess answering each in turn as `statuses` says - 'ok' after those. */
function setup({
  duePositions = [] as DuePosition[],
  statuses = [] as LichessFetchResult['status'][],
} = {}) {
  const cache = {
    duePinned: vi.fn(async () => duePositions),
    sweep: vi.fn(async () => ({ expired: 0, purged: 0 })),
  };
  const remaining = [...statuses];
  const fetcher = {
    configured: true,
    refreshLocal: vi.fn(async () => remaining.shift() ?? 'ok'),
  };
  const sweeper = new ExplorerSweeper(
    cache as unknown as ExplorerCacheService,
    fetcher as unknown as LichessFetcherService,
    { get: vi.fn() } as unknown as ConfigService<AppConfig, true>,
  );
  return { sweeper, cache, fetcher };
}

describe('ExplorerSweeper', () => {
  describe('refreshDue', () => {
    it('fetches every pinned position due', async () => {
      const { sweeper, fetcher } = setup({
        duePositions: [due('a', 'masters'), due('b', 'lichess')],
      });

      expect(await sweeper.refreshDue()).toEqual({ due: 2, fetched: 2 });
      expect(fetcher.refreshLocal).toHaveBeenCalledTimes(2);
    });

    it("asks with the Lichess database's default filters, and none for Masters", async () => {
      const { sweeper, fetcher } = setup({
        duePositions: [due('a', 'masters'), due('b', 'lichess')],
      });

      await sweeper.refreshDue();

      expect(fetcher.refreshLocal).toHaveBeenNthCalledWith(1, {
        positionId: 'a',
        request: { db: 'masters', fen: `${START_EPD} 0 1`, filters: undefined },
      });
      expect(fetcher.refreshLocal).toHaveBeenNthCalledWith(2, {
        positionId: 'b',
        request: {
          db: 'lichess',
          fen: `${START_EPD} 0 1`,
          filters: DEFAULT_LICHESS_FILTERS,
        },
      });
    });

    it('stops at the first position lichess doesn’t answer', async () => {
      for (const status of ['failed', 'rateLimited'] as const) {
        const { sweeper, fetcher } = setup({
          duePositions: [
            due('a', 'masters'),
            due('b', 'masters'),
            due('c', 'masters'),
          ],
          statuses: ['ok', status],
        });

        expect(await sweeper.refreshDue()).toEqual({ due: 3, fetched: 1 });
        expect(fetcher.refreshLocal).toHaveBeenCalledTimes(2);
      }
    });

    it('fetches nothing once stopped', async () => {
      const { sweeper, fetcher } = setup({
        duePositions: [due('a', 'masters')],
      });
      sweeper.onModuleDestroy();

      expect(await sweeper.refreshDue()).toEqual({ due: 1, fetched: 0 });
      expect(fetcher.refreshLocal).not.toHaveBeenCalled();
    });

    it('asks for at most the batch it was given', async () => {
      const { sweeper, cache } = setup();

      await sweeper.refreshDue(5);

      expect(cache.duePinned).toHaveBeenCalledWith(5);
    });
  });

  describe('sweep', () => {
    it('carries on when sweeping fails', async () => {
      const { sweeper, cache } = setup();
      cache.sweep.mockRejectedValueOnce(new Error('connection lost'));

      await expect(sweeper.sweep()).resolves.toBeUndefined();
    });
  });
});

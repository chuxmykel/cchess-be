import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import type { Move } from '../games/entities/move.entity.js';
import {
  EXPLORER_FRESH_MS,
  type ExplorerCacheService,
  type OpenedPosition,
} from './explorer-cache.service.js';
import { ExplorerService } from './explorer.service.js';
import type {
  LichessFetchResult,
  LichessPayload,
} from './lichess/lichess-explorer.client.js';
import type { LichessFetcherService } from './lichess/lichess-fetcher.service.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const PAYLOAD: LichessPayload = {
  white: 50,
  draws: 30,
  black: 20,
  moves: [
    { uci: 'd2d4', san: 'd4', white: 10, draws: 5, black: 5 },
    { uci: 'e2e4', san: 'e4', white: 40, draws: 25, black: 15 },
  ],
};

/** ExplorerService over stand-ins: lichess answering `fetched` (when
 * there's a token at all), and the cache holding `cached`, if anything.
 * The games played here are none. */
function setup({
  configured = true,
  fetched = { status: 'ok', payload: PAYLOAD } as LichessFetchResult,
  cached = null as OpenedPosition['cached'],
} = {}) {
  const moves = { query: vi.fn(async () => []) };
  const cache = {
    open: vi.fn(async () => ({ positionId: 'pos-1', cached })),
    store: vi.fn(async () => {}),
  };
  const fetcher = {
    configured,
    fetch: vi.fn(async () => fetched),
    refreshInBackground: vi.fn(),
  };
  const service = new ExplorerService(
    moves as unknown as Repository<Move>,
    cache as unknown as ExplorerCacheService,
    fetcher as unknown as LichessFetcherService,
  );
  return { service, moves, cache, fetcher };
}

describe('ExplorerService', () => {
  it("asks lichess for a position it hasn't kept, and keeps the answer", async () => {
    const { service, cache, fetcher } = setup();

    const position = await service.explore({ fen: START, db: 'masters' });

    expect(fetcher.fetch).toHaveBeenCalledWith({
      db: 'masters',
      fen: START,
      filters: undefined,
    });
    expect(cache.store).toHaveBeenCalledWith('pos-1', PAYLOAD);
    expect(position).toMatchObject({
      source: 'masters',
      stale: false,
      totalGames: 100,
      whiteWins: 50,
      draws: 30,
      blackWins: 20,
    });
    expect(position.moves.map((move) => move.san)).toEqual(['e4', 'd4']);
    expect(position.moves[0]).toEqual({
      san: 'e4',
      uci: 'e2e4',
      games: 80,
      whiteWins: 40,
      draws: 25,
      blackWins: 15,
    });
  });

  it('answers from what it kept, without asking lichess', async () => {
    const { service, fetcher } = setup({
      cached: { payload: PAYLOAD, fetchedAt: new Date() },
    });

    const position = await service.explore({ fen: START, db: 'lichess' });

    expect(position).toMatchObject({ source: 'lichess', stale: false });
    expect(fetcher.fetch).not.toHaveBeenCalled();
    expect(fetcher.refreshInBackground).not.toHaveBeenCalled();
  });

  it('serves an answer over 30 days old, marked stale, and fetches it afresh', async () => {
    const { service, fetcher } = setup({
      cached: {
        payload: PAYLOAD,
        fetchedAt: new Date(Date.now() - EXPLORER_FRESH_MS - 1000),
      },
    });

    const position = await service.explore({ fen: START, db: 'lichess' });

    expect(position).toMatchObject({ source: 'lichess', stale: true });
    expect(fetcher.fetch).not.toHaveBeenCalled();
    expect(fetcher.refreshInBackground).toHaveBeenCalledWith({
      positionId: 'pos-1',
      request: expect.objectContaining({ db: 'lichess', fen: START }),
    });
  });

  it('asks lichess every time for filters other than its defaults, keeping nothing', async () => {
    const { service, cache, fetcher } = setup();

    const position = await service.explore({
      fen: START,
      db: 'lichess',
      speeds: ['bullet'],
    });

    expect(position.source).toBe('lichess');
    expect(fetcher.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ speeds: ['bullet'] }),
      }),
    );
    expect(cache.open).not.toHaveBeenCalled();
    expect(cache.store).not.toHaveBeenCalled();
  });

  it('keeps answers for the default filters, however they were asked for', async () => {
    const { service, cache } = setup();

    await service.explore({
      fen: START,
      db: 'lichess',
      speeds: ['classical', 'blitz', 'rapid'],
    });

    expect(cache.open).toHaveBeenCalled();
    expect(cache.store).toHaveBeenCalled();
  });

  it('answers from the games played here while lichess is out of reach', async () => {
    for (const fetched of [
      { status: 'failed' },
      { status: 'rateLimited' },
    ] as LichessFetchResult[]) {
      const { service, cache, moves } = setup({ fetched });

      const position = await service.explore({ fen: START, db: 'masters' });

      expect(position).toMatchObject({ source: 'cchess', totalGames: 0 });
      expect(moves.query).toHaveBeenCalled();
      expect(cache.store).not.toHaveBeenCalled();
    }
  });

  it("answers from the games played here when there's no lichess token", async () => {
    const { service, cache, fetcher } = setup({ configured: false });

    const position = await service.explore({ fen: START, db: 'lichess' });

    expect(position.source).toBe('cchess');
    expect(cache.open).not.toHaveBeenCalled();
    expect(fetcher.fetch).not.toHaveBeenCalled();
  });

  it("reads a player's games from the side they played", async () => {
    const { service, moves } = setup();

    const position = await service.explore({
      fen: START,
      db: 'player',
      user: 'user-1',
      color: 'black',
    });

    expect(position.source).toBe('player');
    expect(moves.query).toHaveBeenCalledWith(
      expect.stringContaining('g."blackId" = $2'),
      expect.arrayContaining(['user-1']),
    );
  });

  it('refuses something that is no position', async () => {
    const { service } = setup();

    await expect(service.explore({ fen: 'not a fen' })).rejects.toThrow(
      BadRequestException,
    );
  });
});

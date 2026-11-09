import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { ClusterBus } from '../../cluster/cluster-bus.js';
import {
  CLUSTERING_ENABLED,
  WORKER_INDEX,
} from '../../cluster/cluster.util.js';
import { EXPLORER_RPC } from '../../cluster/rpc-channels.js';
import { ExplorerCacheService } from '../explorer-cache.service.js';
import {
  LichessExplorerClient,
  type LichessExplorerRequest,
  type LichessFetchResult,
} from './lichess-explorer.client.js';
import {
  type FetchLane,
  type FetchQueueState,
  INITIAL_FETCH_QUEUE_STATE,
  LichessFetchQueue,
  type QueueChange,
} from './lichess-fetch-queue.js';
import { LichessFetchStateStore } from './lichess-fetch-state.store.js';

/** A cached position to fetch afresh. */
export interface RefreshJob {
  positionId: string;
  request: LichessExplorerRequest;
}

/** Longer than ClusterBus's default: a player's request may wait behind
 * another's for a moment, and lichess has ten seconds to answer. */
const FETCH_RPC_TIMEOUT_MS = 30_000;

/**
 * Lichess, asked from any worker - always by way of the one queue on the
 * fetcher worker (`LichessFetchQueue`), so the server as a whole sends one
 * request at a time, as matchmaking keeps one seek queue. What the queue
 * learns of lichess's rate limit is kept in the database
 * (LichessFetchStateStore), loaded on boot.
 */
@Injectable()
export class LichessFetcherService implements OnModuleInit {
  static readonly FETCHER_WORKER = 0;
  private readonly logger = new Logger(LichessFetcherService.name);
  private readonly queue: LichessFetchQueue;
  /** Saves one after another, so an older state never lands last. */
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly client: LichessExplorerClient,
    private readonly cache: ExplorerCacheService,
    private readonly clusterBus: ClusterBus,
    private readonly states: LichessFetchStateStore,
  ) {
    this.queue = new LichessFetchQueue(
      (request) => this.client.fetch(request),
      { onChange: (state, change) => this.onQueueChange(state, change) },
    );
    this.clusterBus.onRequest(
      EXPLORER_RPC.FETCH,
      (payload: { request: LichessExplorerRequest; lane: FetchLane }) =>
        this.fetchLocal(payload.request, payload.lane),
    );
    this.clusterBus.onRequest(EXPLORER_RPC.REFRESH, async (job: RefreshJob) => {
      this.refreshUnawaited(job);
      return null;
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.isFetcher) return;
    try {
      const state = await this.states.load();
      if (!state) {
        this.queue.restore(INITIAL_FETCH_QUEUE_STATE);
        return;
      }
      this.queue.restore(state);
      const paused = state.pausedUntil - Date.now();
      this.logger.log(
        `lichess queue restored: ${state.gapMs / 1000}s between background requests` +
          (paused > 0 ? `, paused ${Math.ceil(paused / 1000)}s more` : ''),
      );
    } catch (error) {
      this.logger.warn(
        `Couldn't restore the lichess queue: ${String(error)}; starting afresh`,
      );
    }
  }

  get isFetcher(): boolean {
    return (
      !CLUSTERING_ENABLED ||
      WORKER_INDEX === LichessFetcherService.FETCHER_WORKER
    );
  }

  /** False without a token - nothing is ever asked of lichess. */
  get configured(): boolean {
    return this.client.configured;
  }

  /** A player's request: answered as soon as lichess does, or at once if
   * it can't be asked now. */
  async fetch(request: LichessExplorerRequest): Promise<LichessFetchResult> {
    if (this.isFetcher) return this.fetchLocal(request, 'interactive');
    return this.clusterBus
      .request<LichessFetchResult>(
        LichessFetcherService.FETCHER_WORKER,
        EXPLORER_RPC.FETCH,
        { request, lane: 'interactive' },
        FETCH_RPC_TIMEOUT_MS,
      )
      .catch((): LichessFetchResult => ({ status: 'failed' }));
  }

  /** Fetches a cached position afresh in the background, keeping the
   * answer; returns once it's queued. */
  refreshInBackground(job: RefreshJob): void {
    if (this.isFetcher) {
      this.refreshUnawaited(job);
      return;
    }
    this.clusterBus
      .request(LichessFetcherService.FETCHER_WORKER, EXPLORER_RPC.REFRESH, job)
      .catch((error: unknown) =>
        this.logger.warn(
          `Couldn't queue an explorer refresh: ${String(error)}`,
        ),
      );
  }

  /** The fetcher worker's own: fetches in the background and keeps the
   * answer, resolving once done - so a loop of these goes at the queue's
   * pace. How lichess answered. */
  async refreshLocal(job: RefreshJob): Promise<LichessFetchResult['status']> {
    const result = await this.fetchLocal(job.request, 'background');
    if (result.status === 'ok') {
      await this.cache.store(job.positionId, result.payload);
    }
    return result.status;
  }

  private onQueueChange(state: FetchQueueState, change: QueueChange): void {
    const gap = `${state.gapMs / 1000}s between background requests`;
    switch (change) {
      case 'rateLimited':
        this.logger.warn(
          `lichess rate-limited us (${state.rateLimitedInARow} in a row): pausing ${Math.round((state.pausedUntil - Date.now()) / 1000)}s, then ${gap}`,
        );
        break;
      case 'resumed':
        this.logger.log('lichess is answering again');
        break;
      case 'recovered':
        this.logger.log(`lichess keeps answering: ${gap}`);
        break;
      case 'relaxed':
        this.logger.log(
          `no rate limit for a day: background requests may come down to ${state.floorMs / 1000}s apart`,
        );
        break;
    }
    this.saving = this.saving
      .then(() => this.states.save(state))
      .catch((error: unknown) =>
        this.logger.warn(
          `Couldn't save the lichess queue's state: ${String(error)}`,
        ),
      );
  }

  private refreshUnawaited(job: RefreshJob): void {
    this.refreshLocal(job).catch((error: unknown) =>
      this.logger.warn(`Explorer refresh failed: ${String(error)}`),
    );
  }

  private fetchLocal(
    request: LichessExplorerRequest,
    lane: FetchLane,
  ): Promise<LichessFetchResult> {
    if (!this.client.configured) return Promise.resolve({ status: 'failed' });
    return this.queue.fetch(request, lane);
  }
}

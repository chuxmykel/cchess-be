import { Injectable, Logger } from '@nestjs/common';

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
import { type FetchLane, LichessFetchQueue } from './lichess-fetch-queue.js';

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
 * request at a time, as matchmaking keeps one seek queue.
 */
@Injectable()
export class LichessFetcherService {
  static readonly FETCHER_WORKER = 0;
  private readonly logger = new Logger(LichessFetcherService.name);
  private readonly queue: LichessFetchQueue;

  constructor(
    private readonly client: LichessExplorerClient,
    private readonly cache: ExplorerCacheService,
    private readonly clusterBus: ClusterBus,
  ) {
    this.queue = new LichessFetchQueue((request) => this.client.fetch(request));
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
   * pace. Whether it was fetched. */
  async refreshLocal(job: RefreshJob): Promise<boolean> {
    const result = await this.fetchLocal(job.request, 'background');
    if (result.status !== 'ok') return false;
    await this.cache.store(job.positionId, result.payload);
    return true;
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

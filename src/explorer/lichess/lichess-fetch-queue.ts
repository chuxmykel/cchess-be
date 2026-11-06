import { positionKey } from '../../chess/position-key.js';
import type {
  LichessExplorerRequest,
  LichessFetchResult,
} from './lichess-explorer.client.js';

/** How long lichess is left alone after it answers 429 - it asks for a
 * minute; twice that, to be sure. */
export const LICHESS_RATE_LIMIT_PAUSE_MS = 120_000;
/** The least time between two background requests. */
export const LICHESS_BACKGROUND_GAP_MS = 1_000;

/** A player waiting for the answer, or the server filling its cache. */
export type FetchLane = 'interactive' | 'background';

export interface QueueClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: QueueClock = {
  now: () => Date.now(),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms).unref();
    }),
};

/** The same position and filters, however the FEN's move counters read. */
export function requestKey(request: LichessExplorerRequest): string {
  const filters = request.filters
    ? `${[...request.filters.speeds].sort().join(',')}|${[...request.filters.ratings].sort((a, b) => a - b).join(',')}`
    : '';
  return `${request.db}|${positionKey(request.fen)}|${filters}`;
}

interface Job {
  key: string;
  request: LichessExplorerRequest;
  lane: FetchLane;
  inFlight: boolean;
  promise: Promise<LichessFetchResult>;
  resolve: (result: LichessFetchResult) => void;
}

/**
 * Every request to lichess's explorer goes through one of these, on one
 * worker: one at a time, as lichess asks of API clients, the same request
 * asked twice sent once, and a player's before the cache's. A 429 leaves
 * lichess alone for two minutes - a player asking meanwhile is told at once
 * (and shown the games played here instead); the cache's requests wait.
 */
export class LichessFetchQueue {
  private readonly interactive: Job[] = [];
  private readonly background: Job[] = [];
  private readonly jobs = new Map<string, Job>();
  private pausedUntil = 0;
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  private running = false;

  constructor(
    private readonly send: (
      request: LichessExplorerRequest,
    ) => Promise<LichessFetchResult>,
    private readonly clock: QueueClock = realClock,
  ) {}

  get paused(): boolean {
    return this.clock.now() < this.pausedUntil;
  }

  fetch(
    request: LichessExplorerRequest,
    lane: FetchLane,
  ): Promise<LichessFetchResult> {
    if (lane === 'interactive' && this.paused) {
      return Promise.resolve({ status: 'rateLimited' });
    }
    const key = requestKey(request);
    const existing = this.jobs.get(key);
    if (existing) {
      if (
        lane === 'interactive' &&
        existing.lane === 'background' &&
        !existing.inFlight
      ) {
        this.background.splice(this.background.indexOf(existing), 1);
        existing.lane = 'interactive';
        this.interactive.push(existing);
      }
      return existing.promise;
    }

    let resolve!: (result: LichessFetchResult) => void;
    const promise = new Promise<LichessFetchResult>((settle) => {
      resolve = settle;
    });
    const job: Job = { key, request, lane, inFlight: false, promise, resolve };
    this.jobs.set(key, job);
    (lane === 'interactive' ? this.interactive : this.background).push(job);
    void this.run();
    return promise;
  }

  private settle(job: Job, result: LichessFetchResult): void {
    this.jobs.delete(job.key);
    job.resolve(result);
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        if (this.paused) {
          for (const job of this.interactive.splice(0)) {
            this.settle(job, { status: 'rateLimited' });
          }
          if (this.background.length === 0) return;
          await this.clock.sleep(this.pausedUntil - this.clock.now());
          continue;
        }

        let job = this.interactive.shift();
        if (!job) {
          if (this.background.length === 0) return;
          const wait =
            this.lastRequestAt + LICHESS_BACKGROUND_GAP_MS - this.clock.now();
          if (wait > 0) {
            // A player's request may come in meanwhile: it goes first.
            await this.clock.sleep(wait);
            continue;
          }
          job = this.background.shift()!;
        }

        job.inFlight = true;
        const result = await this.send(job.request).catch(
          (): LichessFetchResult => ({ status: 'failed' }),
        );
        this.lastRequestAt = this.clock.now();
        if (result.status === 'rateLimited') {
          this.pausedUntil = this.clock.now() + LICHESS_RATE_LIMIT_PAUSE_MS;
        }
        this.settle(job, result);
      }
    } finally {
      this.running = false;
    }
  }
}

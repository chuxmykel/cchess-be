import { positionKey } from '../../chess/position-key.js';
import type {
  LichessExplorerRequest,
  LichessFetchResult,
} from './lichess-explorer.client.js';

/** How long lichess is left alone after it answers 429 - it asks for a
 * minute; twice that, to be sure. */
export const LICHESS_RATE_LIMIT_PAUSE_MS = 120_000;
/** After this many 429s with no answer between them, each pause is the
 * long one - lichess is refusing us for more than going too fast. */
export const LICHESS_LONG_PAUSE_AFTER = 5;
export const LICHESS_LONG_PAUSE_MS = 300_000;
/** The time between two background requests to begin with, and the
 * least it ever is. Lichess doesn't say what its limit is, so the queue
 * finds it: each 429 doubles the gap, up to the most, and every so many
 * requests answered in a row shorten it a little - never back down to a
 * gap that has been rate-limited. */
export const LICHESS_BACKGROUND_GAP_MS = 1_000;
export const LICHESS_MAX_BACKGROUND_GAP_MS = 10_000;
/** Requests answered in a row before the gap is shortened. */
export const LICHESS_GAP_RECOVERY_REQUESTS = 100;
/** How much a recovery shortens the gap. */
const GAP_SHRINK = 0.9;
/** How far above a gap that was rate-limited the gap may come back down
 * to. */
const GAP_FLOOR_MARGIN = 1.1;
/** How long without a 429 before the floor is lowered by a tenth - so a
 * limit lichess raises, or one bad hour, doesn't keep the cache slow for
 * good. */
export const LICHESS_FLOOR_RELAX_MS = 24 * 60 * 60 * 1000;

/** What the queue has learned of lichess's limit, kept across restarts
 * (LichessFetchState). Times are epoch milliseconds. */
export interface FetchQueueState {
  /** The time between two background requests now. */
  gapMs: number;
  /** The shortest the gap may come back down to: just over the last gap
   * lichess rate-limited. */
  floorMs: number;
  /** When the floor was last raised or lowered; null at its least. */
  floorSetAt: number | null;
  /** 429s since lichess last answered. */
  rateLimitedInARow: number;
  /** Until when lichess is left alone; 0 when it isn't. */
  pausedUntil: number;
}

export const INITIAL_FETCH_QUEUE_STATE: FetchQueueState = {
  gapMs: LICHESS_BACKGROUND_GAP_MS,
  floorMs: LICHESS_BACKGROUND_GAP_MS,
  floorSetAt: null,
  rateLimitedInARow: 0,
  pausedUntil: 0,
};

/** Why the state changed: a 429; lichess answering again after one; the
 * gap shortened; the floor lowered after a quiet day. */
export type QueueChange = 'rateLimited' | 'resumed' | 'recovered' | 'relaxed';

export interface FetchQueueOptions {
  clock?: QueueClock;
  /** Called with a copy of the state whenever it changes - not on every
   * request answered, only on the four changes above. */
  onChange?: (state: FetchQueueState, change: QueueChange) => void;
}

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
 * lichess alone for two minutes - five minutes from the fifth in a row - a
 * player asking meanwhile is told at once (and shown the games played here
 * instead); the cache's requests wait, further apart from then on (see
 * LICHESS_BACKGROUND_GAP_MS).
 */
export class LichessFetchQueue {
  private readonly interactive: Job[] = [];
  private readonly background: Job[] = [];
  private readonly jobs = new Map<string, Job>();
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  private running = false;
  private state: FetchQueueState = { ...INITIAL_FETCH_QUEUE_STATE };
  private answeredInARow = 0;
  private readonly clock: QueueClock;
  private readonly onChange?: FetchQueueOptions['onChange'];

  constructor(
    private readonly send: (
      request: LichessExplorerRequest,
    ) => Promise<LichessFetchResult>,
    options: FetchQueueOptions = {},
  ) {
    this.clock = options.clock ?? realClock;
    this.onChange = options.onChange;
  }

  get paused(): boolean {
    return this.clock.now() < this.state.pausedUntil;
  }

  /** The time between two background requests now. */
  get backgroundGapMs(): number {
    return this.state.gapMs;
  }

  /** Takes up what was learned before a restart - a pause still running
   * included. */
  restore(state: FetchQueueState): void {
    this.state = { ...state };
  }

  private changed(change: QueueChange): void {
    this.onChange?.({ ...this.state }, change);
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

  /** On a 429: pauses - longer once they come in a row - and slows the
   * background down. While lichess answers: speeds it back up slowly, and
   * after a quiet day lets it come closer to the limit again. */
  private learn(result: LichessFetchResult): void {
    const state = this.state;
    const now = this.clock.now();
    if (result.status === 'rateLimited') {
      this.answeredInARow = 0;
      state.rateLimitedInARow++;
      state.pausedUntil =
        now +
        (state.rateLimitedInARow >= LICHESS_LONG_PAUSE_AFTER
          ? LICHESS_LONG_PAUSE_MS
          : LICHESS_RATE_LIMIT_PAUSE_MS);
      state.floorMs = Math.min(
        LICHESS_MAX_BACKGROUND_GAP_MS,
        Math.max(state.floorMs, Math.round(state.gapMs * GAP_FLOOR_MARGIN)),
      );
      state.floorSetAt = now;
      state.gapMs = Math.min(LICHESS_MAX_BACKGROUND_GAP_MS, state.gapMs * 2);
      this.changed('rateLimited');
      return;
    }
    if (result.status !== 'ok') return;

    if (state.rateLimitedInARow > 0) {
      state.rateLimitedInARow = 0;
      state.pausedUntil = 0;
      this.changed('resumed');
    }
    if (
      state.floorSetAt !== null &&
      now - state.floorSetAt >= LICHESS_FLOOR_RELAX_MS
    ) {
      state.floorMs = Math.max(
        LICHESS_BACKGROUND_GAP_MS,
        Math.round(state.floorMs * GAP_SHRINK),
      );
      state.floorSetAt = state.floorMs > LICHESS_BACKGROUND_GAP_MS ? now : null;
      this.changed('relaxed');
    }
    this.answeredInARow++;
    if (this.answeredInARow < LICHESS_GAP_RECOVERY_REQUESTS) return;
    this.answeredInARow = 0;
    const shorter = Math.max(
      state.floorMs,
      Math.round(state.gapMs * GAP_SHRINK),
    );
    if (shorter < state.gapMs) {
      state.gapMs = shorter;
      this.changed('recovered');
    }
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
          await this.clock.sleep(this.state.pausedUntil - this.clock.now());
          continue;
        }

        let job = this.interactive.shift();
        if (!job) {
          if (this.background.length === 0) return;
          const wait = this.lastRequestAt + this.state.gapMs - this.clock.now();
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
        this.learn(result);
        this.settle(job, result);
      }
    } finally {
      this.running = false;
    }
  }
}

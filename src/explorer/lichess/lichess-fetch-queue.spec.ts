import { describe, expect, it } from 'vitest';

import type {
  LichessExplorerRequest,
  LichessFetchResult,
} from './lichess-explorer.client.js';
import {
  INITIAL_FETCH_QUEUE_STATE,
  LICHESS_BACKGROUND_GAP_MS,
  LICHESS_FLOOR_RELAX_MS,
  LICHESS_GAP_RECOVERY_REQUESTS,
  LICHESS_LONG_PAUSE_AFTER,
  LICHESS_LONG_PAUSE_MS,
  LICHESS_MAX_BACKGROUND_GAP_MS,
  LICHESS_RATE_LIMIT_PAUSE_MS,
  LichessFetchQueue,
  type QueueChange,
  type QueueClock,
  requestKey,
} from './lichess-fetch-queue.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_D4 = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1';

const OK: LichessFetchResult = {
  status: 'ok',
  payload: { white: 1, draws: 0, black: 0, moves: [] },
};

const masters = (fen: string): LichessExplorerRequest => ({
  db: 'masters',
  fen,
});

/** Time that moves only when the queue sleeps, by as long as it sleeps. */
function fakeClock() {
  let now = 1_000_000;
  const sleeps: number[] = [];
  const clock: QueueClock = {
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  };
  return { clock, sleeps, advance: (ms: number) => (now += ms) };
}

/** Lichess, answering each request only when the test says. */
function fakeLichess() {
  const sent: Array<{
    request: LichessExplorerRequest;
    answer: (result: LichessFetchResult) => void;
  }> = [];
  const send = (request: LichessExplorerRequest) =>
    new Promise<LichessFetchResult>((answer) => {
      sent.push({ request, answer });
    });
  return { send, sent };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** A different position for each n - the queue only keys them. */
const position = (n: number) => masters(`p${n} w - - 0 1`);

/** Lichess answering each request at once, as the script says, then OK. */
function scriptedLichess(script: Array<LichessFetchResult['status']>) {
  return async (): Promise<LichessFetchResult> => {
    const status = script.shift() ?? 'ok';
    return status === 'ok' ? OK : { status };
  };
}

/** Sends `count` background requests, one after another. */
async function sendInTurn(queue: LichessFetchQueue, count: number) {
  for (let n = 0; n < count; n++) {
    await queue.fetch(position(n), 'background');
  }
}

describe('LichessFetchQueue', () => {
  it('sends the same position asked twice once, however its FEN counts moves', async () => {
    const lichess = fakeLichess();
    const queue = new LichessFetchQueue(lichess.send, {
      clock: fakeClock().clock,
    });

    const first = queue.fetch(masters(START), 'interactive');
    const second = queue.fetch(
      masters(START.replace('0 1', '3 7')),
      'interactive',
    );
    await flush();
    expect(lichess.sent).toHaveLength(1);
    lichess.sent[0].answer(OK);

    expect(await first).toEqual(OK);
    expect(await second).toEqual(OK);
  });

  it('keeps the Lichess database’s filters apart, in whatever order', () => {
    const filtered = (speeds: string[], ratings: number[]) =>
      requestKey({
        db: 'lichess',
        fen: START,
        filters: { speeds, ratings } as LichessExplorerRequest['filters'] & {},
      });
    expect(filtered(['rapid', 'blitz'], [2000, 1800])).toBe(
      filtered(['blitz', 'rapid'], [1800, 2000]),
    );
    expect(filtered(['blitz'], [1800])).not.toBe(filtered(['rapid'], [1800]));
  });

  it('sends one request at a time', async () => {
    const lichess = fakeLichess();
    const queue = new LichessFetchQueue(lichess.send, {
      clock: fakeClock().clock,
    });

    const first = queue.fetch(masters(START), 'interactive');
    const second = queue.fetch(masters(AFTER_E4), 'interactive');
    await flush();
    expect(lichess.sent).toHaveLength(1);

    lichess.sent[0].answer(OK);
    await first;
    await flush();
    expect(lichess.sent).toHaveLength(2);
    lichess.sent[1].answer(OK);
    expect(await second).toEqual(OK);
  });

  it('sends a player’s request before the cache’s', async () => {
    const lichess = fakeLichess();
    const queue = new LichessFetchQueue(lichess.send, {
      clock: fakeClock().clock,
    });

    void queue.fetch(masters(START), 'interactive');
    void queue.fetch(masters(AFTER_E4), 'background');
    void queue.fetch(masters(AFTER_D4), 'interactive');
    await flush();
    lichess.sent[0].answer(OK);
    await flush();

    expect(lichess.sent[1].request.fen).toBe(AFTER_D4);
  });

  it('moves a cache request a player then asks for to the front', async () => {
    const lichess = fakeLichess();
    const queue = new LichessFetchQueue(lichess.send, {
      clock: fakeClock().clock,
    });

    void queue.fetch(masters(START), 'interactive');
    void queue.fetch(masters(AFTER_E4), 'background');
    void queue.fetch(masters(AFTER_D4), 'background');
    const asked = queue.fetch(masters(AFTER_D4), 'interactive');
    await flush();
    lichess.sent[0].answer(OK);
    await flush();

    expect(lichess.sent[1].request.fen).toBe(AFTER_D4);
    lichess.sent[1].answer(OK);
    expect(await asked).toEqual(OK);
  });

  it('leaves a second between the cache’s requests', async () => {
    const lichess = fakeLichess();
    const time = fakeClock();
    const queue = new LichessFetchQueue(lichess.send, { clock: time.clock });

    void queue.fetch(masters(START), 'background');
    void queue.fetch(masters(AFTER_E4), 'background');
    await flush();
    lichess.sent[0].answer(OK);
    await flush();

    expect(time.sleeps).toEqual([LICHESS_BACKGROUND_GAP_MS]);
    expect(lichess.sent).toHaveLength(2);
  });

  it('leaves lichess alone for two minutes after a 429, telling players at once', async () => {
    const lichess = fakeLichess();
    const time = fakeClock();
    const queue = new LichessFetchQueue(lichess.send, { clock: time.clock });

    const limited = queue.fetch(masters(START), 'interactive');
    const waiting = queue.fetch(masters(AFTER_E4), 'interactive');
    await flush();
    lichess.sent[0].answer({ status: 'rateLimited' });

    expect(await limited).toEqual({ status: 'rateLimited' });
    expect(await waiting).toEqual({ status: 'rateLimited' });
    expect(await queue.fetch(masters(AFTER_D4), 'interactive')).toEqual({
      status: 'rateLimited',
    });
    expect(lichess.sent).toHaveLength(1);

    time.advance(LICHESS_RATE_LIMIT_PAUSE_MS);
    const later = queue.fetch(masters(AFTER_D4), 'interactive');
    await flush();
    expect(lichess.sent).toHaveLength(2);
    lichess.sent[1].answer(OK);
    expect(await later).toEqual(OK);
  });

  it('holds the cache’s requests through the pause', async () => {
    const lichess = fakeLichess();
    const time = fakeClock();
    const queue = new LichessFetchQueue(lichess.send, { clock: time.clock });

    void queue.fetch(masters(START), 'interactive');
    const held = queue.fetch(masters(AFTER_E4), 'background');
    await flush();
    lichess.sent[0].answer({ status: 'rateLimited' });
    await flush();

    expect(time.sleeps).toEqual([LICHESS_RATE_LIMIT_PAUSE_MS]);
    expect(lichess.sent).toHaveLength(2);
    lichess.sent[1].answer(OK);
    expect(await held).toEqual(OK);
  });

  it('reads a request that throws as failed, and goes on', async () => {
    const queue = new LichessFetchQueue(
      () => Promise.reject(new Error('down')),
      { clock: fakeClock().clock },
    );
    expect(await queue.fetch(masters(START), 'interactive')).toEqual({
      status: 'failed',
    });
    expect(await queue.fetch(masters(AFTER_E4), 'interactive')).toEqual({
      status: 'failed',
    });
  });

  it('doubles the gap between the cache’s requests after a 429', async () => {
    const time = fakeClock();
    const queue = new LichessFetchQueue(scriptedLichess(['rateLimited']), {
      clock: time.clock,
    });

    void queue.fetch(position(0), 'background');
    void queue.fetch(position(1), 'background');
    await queue.fetch(position(2), 'background');

    expect(time.sleeps).toEqual([
      LICHESS_RATE_LIMIT_PAUSE_MS,
      LICHESS_BACKGROUND_GAP_MS * 2,
    ]);
  });

  it('stops doubling at the most', async () => {
    const queue = new LichessFetchQueue(
      scriptedLichess(Array(8).fill('rateLimited')),
      { clock: fakeClock().clock },
    );
    await sendInTurn(queue, 8);
    expect(queue.backgroundGapMs).toBe(LICHESS_MAX_BACKGROUND_GAP_MS);
  });

  it('shortens the gap slowly while lichess answers, never back to one it rate-limited', async () => {
    const changes: Array<[number, QueueChange]> = [];
    const queue = new LichessFetchQueue(scriptedLichess(['rateLimited']), {
      clock: fakeClock().clock,
      onChange: (state, change) => changes.push([state.gapMs, change]),
    });

    await sendInTurn(queue, 1 + LICHESS_GAP_RECOVERY_REQUESTS * 7);

    expect(changes).toEqual([
      [2000, 'rateLimited'],
      [2000, 'resumed'],
      [1800, 'recovered'],
      [1620, 'recovered'],
      [1458, 'recovered'],
      [1312, 'recovered'],
      [1181, 'recovered'],
      // Not 1063: 1000 was rate-limited, so 1100 is as short as it goes.
      [1100, 'recovered'],
    ]);
    expect(queue.backgroundGapMs).toBe(1100);
  });

  it('counts the requests answered in a row afresh after a 429', async () => {
    const queue = new LichessFetchQueue(
      scriptedLichess([
        'rateLimited',
        ...Array(LICHESS_GAP_RECOVERY_REQUESTS - 1).fill('ok'),
        'rateLimited',
      ]),
      { clock: fakeClock().clock },
    );
    await sendInTurn(queue, LICHESS_GAP_RECOVERY_REQUESTS + 2);
    expect(queue.backgroundGapMs).toBe(4000);
  });

  it('pauses five minutes from the fifth 429 in a row, until lichess answers', async () => {
    const time = fakeClock();
    const queue = new LichessFetchQueue(
      scriptedLichess([
        ...Array(LICHESS_LONG_PAUSE_AFTER + 1).fill('rateLimited'),
        'ok',
        'rateLimited',
      ]),
      { clock: time.clock },
    );

    await sendInTurn(queue, LICHESS_LONG_PAUSE_AFTER + 3);

    const pauses = time.sleeps.filter(
      (ms) => ms >= LICHESS_RATE_LIMIT_PAUSE_MS,
    );
    expect(pauses).toEqual([
      ...Array(LICHESS_LONG_PAUSE_AFTER - 1).fill(LICHESS_RATE_LIMIT_PAUSE_MS),
      LICHESS_LONG_PAUSE_MS,
      LICHESS_LONG_PAUSE_MS,
    ]);
    // Answered, then limited again: back to the short pause.
    expect(queue.paused).toBe(true);
    time.advance(LICHESS_RATE_LIMIT_PAUSE_MS);
    expect(queue.paused).toBe(false);
  });

  it('takes up a restored pause and gap', async () => {
    const lichess = fakeLichess();
    const time = fakeClock();
    const queue = new LichessFetchQueue(lichess.send, { clock: time.clock });
    queue.restore({
      ...INITIAL_FETCH_QUEUE_STATE,
      gapMs: 3000,
      floorMs: 2200,
      pausedUntil: time.clock.now() + 60_000,
    });

    expect(await queue.fetch(masters(START), 'interactive')).toEqual({
      status: 'rateLimited',
    });
    void queue.fetch(masters(AFTER_E4), 'background');
    void queue.fetch(masters(AFTER_D4), 'background');
    await flush();
    expect(time.sleeps).toEqual([60_000]);
    lichess.sent[0].answer(OK);
    await flush();

    expect(time.sleeps).toEqual([60_000, 3000]);
    expect(queue.backgroundGapMs).toBe(3000);
  });

  it('lowers the floor after a day with no 429', async () => {
    const time = fakeClock();
    const changes: Array<[number, QueueChange]> = [];
    const queue = new LichessFetchQueue(scriptedLichess([]), {
      clock: time.clock,
      onChange: (state, change) => changes.push([state.floorMs, change]),
    });
    queue.restore({
      ...INITIAL_FETCH_QUEUE_STATE,
      gapMs: 2000,
      floorMs: 2000,
      floorSetAt: time.clock.now(),
    });

    await sendInTurn(queue, 1);
    expect(changes).toEqual([]);
    time.advance(LICHESS_FLOOR_RELAX_MS);
    await queue.fetch(position(1), 'background');

    expect(changes).toEqual([[1800, 'relaxed']]);
  });
});

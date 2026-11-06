import { describe, expect, it } from 'vitest';

import type {
  LichessExplorerRequest,
  LichessFetchResult,
} from './lichess-explorer.client.js';
import {
  LICHESS_BACKGROUND_GAP_MS,
  LICHESS_RATE_LIMIT_PAUSE_MS,
  LichessFetchQueue,
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

describe('LichessFetchQueue', () => {
  it('sends the same position asked twice once, however its FEN counts moves', async () => {
    const lichess = fakeLichess();
    const queue = new LichessFetchQueue(lichess.send, fakeClock().clock);

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
    const queue = new LichessFetchQueue(lichess.send, fakeClock().clock);

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
    const queue = new LichessFetchQueue(lichess.send, fakeClock().clock);

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
    const queue = new LichessFetchQueue(lichess.send, fakeClock().clock);

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
    const queue = new LichessFetchQueue(lichess.send, time.clock);

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
    const queue = new LichessFetchQueue(lichess.send, time.clock);

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
    const queue = new LichessFetchQueue(lichess.send, time.clock);

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
      fakeClock().clock,
    );
    expect(await queue.fetch(masters(START), 'interactive')).toEqual({
      status: 'failed',
    });
    expect(await queue.fetch(masters(AFTER_E4), 'interactive')).toEqual({
      status: 'failed',
    });
  });
});

import { describe, expect, it } from 'vitest';

import { KeyedMutex } from './keyed-mutex.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe('KeyedMutex', () => {
  it('runs work under one key one at a time, in order', async () => {
    const mutex = new KeyedMutex();
    const ran: string[] = [];
    const first = deferred();

    const a = mutex.runExclusive('game', async () => {
      await first.promise;
      ran.push('a');
    });
    const b = mutex.runExclusive('game', async () => {
      ran.push('b');
    });
    first.resolve();
    await Promise.all([a, b]);

    expect(ran).toEqual(['a', 'b']);
  });

  describe('drain', () => {
    it('resolves at once with nothing queued', async () => {
      await expect(new KeyedMutex().drain()).resolves.toBeUndefined();
    });

    it('waits for the work under way, under every key', async () => {
      const mutex = new KeyedMutex();
      const done: string[] = [];
      const slow = deferred();
      void mutex.runExclusive('one', async () => {
        await slow.promise;
        done.push('one');
      });
      void mutex.runExclusive('two', async () => {
        done.push('two');
      });

      let drained = false;
      const draining = mutex.drain().then(() => (drained = true));
      await Promise.resolve();
      expect(drained).toBe(false);

      slow.resolve();
      await draining;
      expect(done.sort()).toEqual(['one', 'two']);
    });

    it('waits for work queued while it waits', async () => {
      const mutex = new KeyedMutex();
      const done: string[] = [];
      void mutex.runExclusive('game', async () => {
        done.push('move');
        // As a move queues its player's opponent's pre-move.
        void mutex.runExclusive('game', async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          done.push('premove');
        });
      });

      await mutex.drain();

      expect(done).toEqual(['move', 'premove']);
    });

    it('carries on past work that failed', async () => {
      const mutex = new KeyedMutex();
      const failed = mutex.runExclusive('game', async () => {
        throw new Error('boom');
      });

      await mutex.drain();
      await expect(failed).rejects.toThrow('boom');
    });
  });
});
